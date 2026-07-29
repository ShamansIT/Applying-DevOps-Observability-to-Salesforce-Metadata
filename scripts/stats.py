#!/usr/bin/env python3
"""Frozen-results statistics. Separate tool, deliberately outside the TypeScript core and vitest, so
inference never touches analysis code. Reads a run's paired csv and computes the paired tests the
evaluation reports: median and IQR per arm, median difference with a seeded bootstrap interval,
Wilcoxon signed-rank and sign tests, Holm correction across the metric family, and McNemar on paired
task outcomes. Standard library only, so it runs anywhere with Python 3. See ADR 015.

Inputs, under a results/<freeze-id>/ directory:
  paired.csv    unit,metric,prototype,baseline   one row per unit and metric
  outcomes.csv  unit,prototype_correct,baseline_correct   0/1, optional, for McNemar

Outputs, into the same directory:
  stats.json    full record
  stats.csv     one row per metric plus a mcnemar row

Usage:
  python scripts/stats.py results/<freeze-id> [--seed 12345] [--bootstrap 10000]
  python scripts/stats.py --selftest
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import sys
from itertools import product


# --- summary ---------------------------------------------------------------


def median(values):
    if not values:
        return 0.0
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    if n % 2 == 1:
        return float(ordered[mid])
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def quantile(values, q):
    # Linear interpolation between order statistics, same convention as common stats packages.
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    pos = (len(ordered) - 1) * q
    low = math.floor(pos)
    high = math.ceil(pos)
    if low == high:
        return float(ordered[int(pos)])
    frac = pos - low
    return ordered[low] * (1 - frac) + ordered[high] * frac


def iqr(values):
    return quantile(values, 0.75) - quantile(values, 0.25)


# --- distributions ---------------------------------------------------------


def phi(z):
    # Standard normal cdf via erf.
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def chi2_sf_df1(x):
    # Survival function of chi-square with one degree of freedom, closed form.
    if x <= 0:
        return 1.0
    return math.erfc(math.sqrt(x / 2.0))


def binom_two_sided(k, n, p=0.5):
    # Two-sided exact binomial p-value for k successes in n trials.
    if n == 0:
        return 1.0
    tail = min(k, n - k)
    cumulative = sum(math.comb(n, i) * (p ** i) * ((1 - p) ** (n - i)) for i in range(tail + 1))
    return min(1.0, 2.0 * cumulative)


# --- ranks -----------------------------------------------------------------


def average_ranks(values):
    # Fractional ranks, ties share the mean of the ranks they span.
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        shared = (i + 1 + j + 1) / 2.0  # ranks are 1-based
        for k in range(i, j + 1):
            ranks[order[k]] = shared
        i = j + 1
    return ranks


# --- paired tests ----------------------------------------------------------


def wilcoxon_signed_rank(diffs):
    # Two-sided Wilcoxon signed-rank. Exact by enumeration for small n, normal approximation with a
    # continuity correction otherwise. Zero differences are dropped, per the standard procedure.
    nonzero = [d for d in diffs if d != 0]
    n = len(nonzero)
    if n == 0:
        return {"n": 0, "w": 0.0, "p": 1.0, "method": "none"}
    ranks = average_ranks([abs(d) for d in nonzero])
    w_plus = sum(r for r, d in zip(ranks, nonzero) if d > 0)
    w_minus = sum(r for r, d in zip(ranks, nonzero) if d < 0)
    w = min(w_plus, w_minus)

    if n <= 15:
        total = 0
        at_least = 0
        for signs in product((0, 1), repeat=n):
            total += 1
            stat = min(
                sum(r for r, s in zip(ranks, signs) if s == 1),
                sum(r for r, s in zip(ranks, signs) if s == 0),
            )
            if stat <= w:
                at_least += 1
        return {"n": n, "w": w, "p": min(1.0, at_least / total), "method": "exact"}

    mean = n * (n + 1) / 4.0
    sd = math.sqrt(n * (n + 1) * (2 * n + 1) / 24.0)
    z = (abs(w - mean) - 0.5) / sd if sd > 0 else 0.0
    return {"n": n, "w": w, "p": min(1.0, 2.0 * (1.0 - phi(z))), "method": "normal"}


def sign_test(diffs):
    pos = sum(1 for d in diffs if d > 0)
    neg = sum(1 for d in diffs if d < 0)
    n = pos + neg
    return {"n": n, "positive": pos, "negative": neg, "p": binom_two_sided(min(pos, neg), n)}


def bootstrap_median_ci(diffs, rounds, seed, alpha=0.05):
    if not diffs:
        return {"median": 0.0, "low": 0.0, "high": 0.0, "rounds": 0}
    rng = random.Random(seed)
    n = len(diffs)
    medians = []
    for _ in range(rounds):
        sample = [diffs[rng.randrange(n)] for _ in range(n)]
        medians.append(median(sample))
    return {
        "median": median(diffs),
        "low": quantile(medians, alpha / 2.0),
        "high": quantile(medians, 1 - alpha / 2.0),
        "rounds": rounds,
    }


def holm(pvalues):
    # Holm step-down. Returns adjusted p-values in the original order, monotone non-decreasing.
    m = len(pvalues)
    order = sorted(range(m), key=lambda i: pvalues[i])
    adjusted = [0.0] * m
    running = 0.0
    for rank, idx in enumerate(order):
        value = min(1.0, (m - rank) * pvalues[idx])
        running = max(running, value)
        adjusted[idx] = running
    return adjusted


def mcnemar(pairs):
    # pairs: list of (prototype_correct, baseline_correct) as 0/1. Exact for few discordant pairs,
    # chi-square with continuity otherwise.
    b = sum(1 for p, base in pairs if p == 1 and base == 0)
    c = sum(1 for p, base in pairs if p == 0 and base == 1)
    n = b + c
    if n == 0:
        return {"b": b, "c": c, "statistic": 0.0, "p": 1.0, "method": "none"}
    if n < 25:
        return {"b": b, "c": c, "statistic": float(min(b, c)), "p": binom_two_sided(min(b, c), n), "method": "exact"}
    statistic = (abs(b - c) - 1) ** 2 / n
    return {"b": b, "c": c, "statistic": statistic, "p": chi2_sf_df1(statistic), "method": "chi2"}


# --- driving ---------------------------------------------------------------


def read_paired(path):
    metrics = {}
    with open(path, newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            metric = row["metric"]
            proto = float(row["prototype"])
            base = float(row["baseline"])
            metrics.setdefault(metric, []).append((proto, base))
    return metrics


def read_outcomes(path):
    pairs = []
    with open(path, newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            pairs.append((int(row["prototype_correct"]), int(row["baseline_correct"])))
    return pairs


def compute(directory, seed, rounds):
    metrics = read_paired(os.path.join(directory, "paired.csv"))
    names = sorted(metrics)
    per_metric = {}
    raw_p = []
    for name in names:
        proto = [p for p, _ in metrics[name]]
        base = [b for _, b in metrics[name]]
        diffs = [p - b for p, b in metrics[name]]
        wil = wilcoxon_signed_rank(diffs)
        per_metric[name] = {
            "n": len(diffs),
            "median_prototype": median(proto),
            "median_baseline": median(base),
            "iqr_prototype": iqr(proto),
            "iqr_baseline": iqr(base),
            "bootstrap": bootstrap_median_ci(diffs, rounds, seed),
            "wilcoxon": wil,
            "sign": sign_test(diffs),
        }
        raw_p.append(wil["p"])
    adjusted = holm(raw_p)
    for name, adj in zip(names, adjusted):
        per_metric[name]["wilcoxon_holm_p"] = adj

    record = {"seed": seed, "bootstrap_rounds": rounds, "metrics": per_metric}

    outcomes_path = os.path.join(directory, "outcomes.csv")
    if os.path.exists(outcomes_path):
        record["mcnemar"] = mcnemar(read_outcomes(outcomes_path))
    return record


def to_csv(record):
    header = [
        "metric",
        "n",
        "median_prototype",
        "median_baseline",
        "iqr_prototype",
        "iqr_baseline",
        "median_diff",
        "ci_low",
        "ci_high",
        "wilcoxon_p",
        "wilcoxon_holm_p",
        "sign_p",
    ]
    rows = [",".join(header)]
    for name in sorted(record["metrics"]):
        m = record["metrics"][name]
        rows.append(
            ",".join(
                str(x)
                for x in [
                    name,
                    m["n"],
                    round(m["median_prototype"], 4),
                    round(m["median_baseline"], 4),
                    round(m["iqr_prototype"], 4),
                    round(m["iqr_baseline"], 4),
                    round(m["bootstrap"]["median"], 4),
                    round(m["bootstrap"]["low"], 4),
                    round(m["bootstrap"]["high"], 4),
                    round(m["wilcoxon"]["p"], 4),
                    round(m["wilcoxon_holm_p"], 4),
                    round(m["sign"]["p"], 4),
                ]
            )
        )
    if "mcnemar" in record:
        mc = record["mcnemar"]
        rows.append(f"mcnemar,{mc['b'] + mc['c']},b={mc['b']},c={mc['c']},,,,,,{round(mc['p'], 4)},,")
    return "\n".join(rows) + "\n"


def run(directory, seed, rounds):
    record = compute(directory, seed, rounds)
    with open(os.path.join(directory, "stats.json"), "w", encoding="utf-8") as handle:
        json.dump(record, handle, indent=2)
        handle.write("\n")
    with open(os.path.join(directory, "stats.csv"), "w", encoding="utf-8") as handle:
        handle.write(to_csv(record))
    metric_count = len(record["metrics"])
    return f"stats: {metric_count} metric(s) written to {directory}"


# --- self test -------------------------------------------------------------


def close(a, b, tol=1e-6):
    return abs(a - b) <= tol


def selftest():
    assert close(median([1, 2, 3, 4]), 2.5)
    assert close(quantile([1, 2, 3, 4, 5], 0.25), 2.0)
    assert close(iqr([1, 2, 3, 4, 5]), 2.0)

    # Wilcoxon exact, textbook: diffs with a known small-sample two-sided p.
    wil = wilcoxon_signed_rank([1, 2, 3, -4, 5, 6])
    assert wil["method"] == "exact"
    assert 0.0 < wil["p"] <= 1.0
    # All-positive differences give the strongest signed-rank result the sample size allows.
    strong = wilcoxon_signed_rank([1, 2, 3, 4, 5, 6])
    assert close(strong["p"], 2.0 / (2 ** 6))

    # Sign test: five positive, one negative.
    sign = sign_test([1, 1, 1, 1, 1, -1])
    assert sign["positive"] == 5 and sign["negative"] == 1
    assert close(sign["p"], binom_two_sided(1, 6))

    # Holm on a known vector.
    adj = holm([0.01, 0.04, 0.03])
    assert close(adj[0], 0.03) and close(adj[1], 0.06) and close(adj[2], 0.06)

    # McNemar exact, discordant 1 vs 9.
    mc = mcnemar([(1, 0)] + [(0, 1)] * 9)
    assert mc["b"] == 1 and mc["c"] == 9
    assert close(mc["p"], binom_two_sided(1, 10))

    # Bootstrap interval is reproducible for a fixed seed and brackets the sample median.
    first = bootstrap_median_ci([1, 2, 3, 4, 5], 500, 12345)
    second = bootstrap_median_ci([1, 2, 3, 4, 5], 500, 12345)
    assert first == second
    assert first["low"] <= first["median"] <= first["high"]

    print("stats selftest: ok")


def main(argv):
    parser = argparse.ArgumentParser(description="Frozen-results statistics.")
    parser.add_argument("directory", nargs="?", help="results/<freeze-id> directory")
    parser.add_argument("--seed", type=int, default=12345)
    parser.add_argument("--bootstrap", type=int, default=10000)
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(argv)

    if args.selftest:
        selftest()
        return 0
    if not args.directory:
        parser.error("directory is required unless --selftest is given")
    print(run(args.directory, args.seed, args.bootstrap))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

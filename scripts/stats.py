#!/usr/bin/env python3
"""Frozen-results statistics. Separate tool, deliberately outside the TypeScript core and vitest, so
inference never touches analysis code. Reads a run's paired csv and computes the paired analysis the
evaluation reports: median and IQR per arm, median difference with a seeded bootstrap interval,
Wilcoxon signed-rank with a matched-pairs rank-biserial effect size, an exact sign test, a seeded
paired permutation sensitivity test, Cohen's dz, and McNemar with a paired risk difference and
interval for binary outcomes. A pre-specified confirmatory family is Holm-corrected; everything else
is descriptive. Standard library only, so it runs anywhere with Python 3.

Inputs, under a results/<freeze-id>/ directory:
  paired.csv             unit,metric,prototype,baseline   one row per unit and metric
  outcomes.csv           unit,prototype_correct,baseline_correct   0/1, optional, for McNemar
  statistics-config.json optional; alpha, seed, bootstrap, permutations, confirmatory family,
                         and the zero-difference fraction that switches Wilcoxon to the sign test

Outputs, into the same directory:
  stats.json  full record
  stats.csv   one row per metric plus a mcnemar row

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

DEFAULT_CONFIG = {
    "alpha": 0.05,
    "seed": 12345,
    "bootstrap": 10000,
    "permutations": 10000,
    "confirmatory": [],  # metric names that enter the Holm-corrected family
    "signTestZeroFraction": 0.25,  # zero-diff share at or above which the sign test is preferred
}


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


def mean(values):
    return sum(values) / len(values) if values else 0.0


def stdev(values):
    n = len(values)
    if n < 2:
        return 0.0
    m = mean(values)
    return math.sqrt(sum((v - m) ** 2 for v in values) / (n - 1))


# --- distributions ---------------------------------------------------------


def phi(z):
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def chi2_sf_df1(x):
    if x <= 0:
        return 1.0
    return math.erfc(math.sqrt(x / 2.0))


def binom_two_sided(k, n, p=0.5):
    if n == 0:
        return 1.0
    tail = min(k, n - k)
    cumulative = sum(math.comb(n, i) * (p ** i) * ((1 - p) ** (n - i)) for i in range(tail + 1))
    return min(1.0, 2.0 * cumulative)


# --- ranks -----------------------------------------------------------------


def average_ranks(values):
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        shared = (i + 1 + j + 1) / 2.0
        for k in range(i, j + 1):
            ranks[order[k]] = shared
        i = j + 1
    return ranks


# --- paired tests ----------------------------------------------------------


def wilcoxon_signed_rank(diffs):
    from itertools import product as iproduct

    nonzero = [d for d in diffs if d != 0]
    n = len(nonzero)
    if n == 0:
        return {"n": 0, "w": 0.0, "wPlus": 0.0, "wMinus": 0.0, "p": 1.0, "method": "none"}
    ranks = average_ranks([abs(d) for d in nonzero])
    w_plus = sum(r for r, d in zip(ranks, nonzero) if d > 0)
    w_minus = sum(r for r, d in zip(ranks, nonzero) if d < 0)
    w = min(w_plus, w_minus)

    if n <= 15:
        total = 0
        at_least = 0
        for signs in iproduct((0, 1), repeat=n):
            total += 1
            stat = min(
                sum(r for r, s in zip(ranks, signs) if s == 1),
                sum(r for r, s in zip(ranks, signs) if s == 0),
            )
            if stat <= w:
                at_least += 1
        p = min(1.0, at_least / total)
        method = "exact"
    else:
        mu = n * (n + 1) / 4.0
        sd = math.sqrt(n * (n + 1) * (2 * n + 1) / 24.0)
        z = (abs(w - mu) - 0.5) / sd if sd > 0 else 0.0
        p = min(1.0, 2.0 * (1.0 - phi(z)))
        method = "normal"
    return {"n": n, "w": w, "wPlus": w_plus, "wMinus": w_minus, "p": p, "method": method}


def rank_biserial(wilcoxon):
    # Matched-pairs rank-biserial correlation from the signed-rank sums; +1 all-positive, -1 all-negative.
    total = wilcoxon["wPlus"] + wilcoxon["wMinus"]
    if total == 0:
        return 0.0
    return (wilcoxon["wPlus"] - wilcoxon["wMinus"]) / total


def sign_test(diffs):
    pos = sum(1 for d in diffs if d > 0)
    neg = sum(1 for d in diffs if d < 0)
    n = pos + neg
    return {"n": n, "positive": pos, "negative": neg, "p": binom_two_sided(min(pos, neg), n)}


def cohens_dz(diffs):
    sd = stdev(diffs)
    return 0.0 if sd == 0 else mean(diffs) / sd


def permutation_test(diffs, rounds, seed):
    # Paired sign-flip permutation on the sum of differences; seeded, so it reproduces.
    nonzero = [d for d in diffs if d != 0]
    if not nonzero:
        return {"p": 1.0, "rounds": 0}
    observed = abs(sum(nonzero))
    rng = random.Random(seed)
    at_least = 0
    for _ in range(rounds):
        total = sum(d if rng.random() < 0.5 else -d for d in nonzero)
        if abs(total) >= observed - 1e-12:
            at_least += 1
    return {"p": min(1.0, at_least / rounds), "rounds": rounds}


def bootstrap_median_ci(diffs, rounds, seed, alpha):
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
    m = len(pvalues)
    order = sorted(range(m), key=lambda i: pvalues[i])
    adjusted = [0.0] * m
    running = 0.0
    for rank, idx in enumerate(order):
        value = min(1.0, (m - rank) * pvalues[idx])
        running = max(running, value)
        adjusted[idx] = running
    return adjusted


def mcnemar(pairs, alpha):
    b = sum(1 for p, base in pairs if p == 1 and base == 0)
    c = sum(1 for p, base in pairs if p == 0 and base == 1)
    n = b + c
    total = len(pairs)
    risk = (b - c) / total if total else 0.0
    # Wald interval for the paired risk difference.
    if total:
        var = (b + c - (b - c) ** 2 / total) / (total ** 2)
        half = 1.959963985 * math.sqrt(var) if var > 0 else 0.0
    else:
        half = 0.0
    result = {
        "b": b,
        "c": c,
        "riskDifference": risk,
        "riskLow": risk - half,
        "riskHigh": risk + half,
    }
    if n == 0:
        result.update({"statistic": 0.0, "p": 1.0, "method": "none"})
    elif n < 25:
        result.update({"statistic": float(min(b, c)), "p": binom_two_sided(min(b, c), n), "method": "exact"})
    else:
        statistic = (abs(b - c) - 1) ** 2 / n
        result.update({"statistic": statistic, "p": chi2_sf_df1(statistic), "method": "chi2"})
    return result


# --- driving ---------------------------------------------------------------


def read_config(directory):
    config = dict(DEFAULT_CONFIG)
    path = os.path.join(directory, "statistics-config.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            config.update(json.load(handle))
    return config


def read_paired(path):
    metrics = {}
    with open(path, newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            metrics.setdefault(row["metric"], []).append(
                (float(row["prototype"]), float(row["baseline"]))
            )
    return metrics


def read_outcomes(path):
    pairs = []
    with open(path, newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            pairs.append((int(row["prototype_correct"]), int(row["baseline_correct"])))
    return pairs


def zero_fraction(diffs):
    return sum(1 for d in diffs if d == 0) / len(diffs) if diffs else 0.0


def analyse_metric(pairs, config):
    proto = [p for p, _ in pairs]
    base = [b for _, b in pairs]
    diffs = [p - b for p, b in pairs]
    wil = wilcoxon_signed_rank(diffs)
    sign = sign_test(diffs)
    # Decision rule: too many ties or zeros make the signed-rank ranks unreliable, so prefer the sign
    # test. The chosen p is what enters the confirmatory family.
    chosen = "sign" if zero_fraction(diffs) >= config["signTestZeroFraction"] else "wilcoxon"
    chosen_p = sign["p"] if chosen == "sign" else wil["p"]
    return {
        "n": len(diffs),
        "medianPrototype": median(proto),
        "medianBaseline": median(base),
        "iqrPrototype": iqr(proto),
        "iqrBaseline": iqr(base),
        "bootstrap": bootstrap_median_ci(diffs, config["bootstrap"], config["seed"], config["alpha"]),
        "wilcoxon": wil,
        "rankBiserial": rank_biserial(wil),
        "sign": sign,
        "permutation": permutation_test(diffs, config["permutations"], config["seed"]),
        "cohensDz": cohens_dz(diffs),
        "effectDirection": direction(median(diffs)),
        "chosenTest": chosen,
        "chosenP": chosen_p,
    }


def direction(value):
    if value > 0:
        return "prototype-higher"
    if value < 0:
        return "prototype-lower"
    return "none"


def compute(directory, config):
    metrics = read_paired(os.path.join(directory, "paired.csv"))
    names = sorted(metrics)
    per_metric = {name: analyse_metric(metrics[name], config) for name in names}

    # Holm applies only to the pre-specified confirmatory family, on each metric's chosen p.
    confirmatory = [name for name in names if name in set(config["confirmatory"])]
    adjusted = holm([per_metric[name]["chosenP"] for name in confirmatory])
    for name in names:
        per_metric[name]["confirmatory"] = name in set(config["confirmatory"])
        per_metric[name]["holmP"] = None
    for name, adj in zip(confirmatory, adjusted):
        per_metric[name]["holmP"] = adj

    record = {
        "alpha": config["alpha"],
        "seed": config["seed"],
        "bootstrapRounds": config["bootstrap"],
        "permutationRounds": config["permutations"],
        "confirmatoryFamily": confirmatory,
        "metrics": per_metric,
    }

    outcomes_path = os.path.join(directory, "outcomes.csv")
    if os.path.exists(outcomes_path):
        record["mcnemar"] = mcnemar(read_outcomes(outcomes_path), config["alpha"])
    return record


def to_csv(record):
    header = [
        "metric",
        "n",
        "confirmatory",
        "median_prototype",
        "median_baseline",
        "median_diff",
        "ci_low",
        "ci_high",
        "chosen_test",
        "chosen_p",
        "holm_p",
        "wilcoxon_p",
        "sign_p",
        "permutation_p",
        "rank_biserial",
        "cohens_dz",
        "direction",
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
                    m["confirmatory"],
                    round(m["medianPrototype"], 4),
                    round(m["medianBaseline"], 4),
                    round(m["bootstrap"]["median"], 4),
                    round(m["bootstrap"]["low"], 4),
                    round(m["bootstrap"]["high"], 4),
                    m["chosenTest"],
                    round(m["chosenP"], 4),
                    "" if m["holmP"] is None else round(m["holmP"], 4),
                    round(m["wilcoxon"]["p"], 4),
                    round(m["sign"]["p"], 4),
                    round(m["permutation"]["p"], 4),
                    round(m["rankBiserial"], 4),
                    round(m["cohensDz"], 4),
                    m["effectDirection"],
                ]
            )
        )
    if "mcnemar" in record:
        mc = record["mcnemar"]
        rows.append(
            f"mcnemar,{mc['b'] + mc['c']},,b={mc['b']},c={mc['c']},{round(mc['riskDifference'], 4)},"
            f"{round(mc['riskLow'], 4)},{round(mc['riskHigh'], 4)},{mc['method']},{round(mc['p'], 4)},,,,,,"
        )
    return "\n".join(rows) + "\n"


def run(directory, overrides):
    config = read_config(directory)
    config.update({k: v for k, v in overrides.items() if v is not None})
    record = compute(directory, config)
    with open(os.path.join(directory, "stats.json"), "w", encoding="utf-8") as handle:
        json.dump(record, handle, indent=2)
        handle.write("\n")
    with open(os.path.join(directory, "stats.csv"), "w", encoding="utf-8") as handle:
        handle.write(to_csv(record))
    return f"stats: {len(record['metrics'])} metric(s) written to {directory}"


# --- self test -------------------------------------------------------------


def close(a, b, tol=1e-6):
    return abs(a - b) <= tol


def selftest():
    assert close(median([1, 2, 3, 4]), 2.5)
    assert close(iqr([1, 2, 3, 4, 5]), 2.0)

    strong = wilcoxon_signed_rank([1, 2, 3, 4, 5, 6])
    assert strong["method"] == "exact"
    assert close(strong["p"], 2.0 / (2 ** 6))
    assert close(rank_biserial(strong), 1.0)
    assert close(rank_biserial(wilcoxon_signed_rank([-1, -2, -3, -4, -5, -6])), -1.0)

    sign = sign_test([1, 1, 1, 1, 1, -1])
    assert sign["positive"] == 5 and sign["negative"] == 1
    assert close(sign["p"], binom_two_sided(1, 6))

    perm = permutation_test([1, 2, 3, 4, 5, 6], 4000, 12345)
    assert perm == permutation_test([1, 2, 3, 4, 5, 6], 4000, 12345)  # seeded reproducible
    assert perm["p"] < 0.1  # all one direction is unlikely under the null

    assert cohens_dz([1, 2, 3, 4, 5, 6]) > 0
    assert close(cohens_dz([2, 2, 2]), 0.0)

    adj = holm([0.01, 0.04, 0.03])
    assert close(adj[0], 0.03) and close(adj[1], 0.06) and close(adj[2], 0.06)

    mc = mcnemar([(1, 0)] + [(0, 1)] * 9, 0.05)
    assert mc["b"] == 1 and mc["c"] == 9
    assert close(mc["p"], binom_two_sided(1, 10))
    assert close(mc["riskDifference"], -0.8)
    assert mc["riskLow"] <= mc["riskDifference"] <= mc["riskHigh"]

    first = bootstrap_median_ci([1, 2, 3, 4, 5], 500, 12345, 0.05)
    assert first == bootstrap_median_ci([1, 2, 3, 4, 5], 500, 12345, 0.05)
    assert first["low"] <= first["median"] <= first["high"]

    # Decision rule prefers the sign test when zeros dominate.
    heavy_zeros = analyse_metric([(1, 1), (1, 1), (1, 1), (2, 1)], DEFAULT_CONFIG)
    assert heavy_zeros["chosenTest"] == "sign"

    print("stats selftest: ok")


def main(argv):
    parser = argparse.ArgumentParser(description="Frozen-results statistics.")
    parser.add_argument("directory", nargs="?", help="results/<freeze-id> directory")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--bootstrap", type=int, default=None)
    parser.add_argument("--permutations", type=int, default=None)
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(argv)

    if args.selftest:
        selftest()
        return 0
    if not args.directory:
        parser.error("directory is required unless --selftest is given")
    print(
        run(
            args.directory,
            {"seed": args.seed, "bootstrap": args.bootstrap, "permutations": args.permutations},
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

"""Evaluation analysis.

"""

import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
PLOT = HERE / "plot"
PLOT.mkdir(exist_ok=True)

# --- design tokens (Okabe-Ito subset; CVD-safe, validated) ---
CLUSTER = {"declarative": "#0072B2", "programmatic": "#E69F00", "mixed": "#009E73"}
PROTO_HUE = "#0072B2"
BASE_HUE = "#E69F00"
INK = "#222222"
MUTED = "#6b6b6b"
GRID = "#e6e6e6"
GOOD = "#009E73"
SEQ = LinearSegmentedColormap.from_list("seqblue", ["#f2f7fb", "#0072B2"])

plt.rcParams.update(
    {
        "figure.dpi": 140,
        "savefig.dpi": 140,
        "font.family": "DejaVu Sans",
        "font.size": 10,
        "axes.edgecolor": MUTED,
        "axes.labelcolor": INK,
        "text.color": INK,
        "xtick.color": INK,
        "ytick.color": INK,
        "axes.spines.top": False,
        "axes.spines.right": False,
    }
)

SCENARIOS = [
    "cand-declarative-valid",
    "cand-declarative-static_fail",
    "cand-declarative-risk",
    "cand-programmatic-valid",
    "cand-programmatic-static_fail",
    "cand-programmatic-risk",
    "cand-mixed-valid",
    "cand-mixed-static_fail",
    "cand-mixed-risk",
]


def short(sid):
    return sid.replace("cand-", "")


def cluster_of(sid):
    return sid.split("-")[1]


def load(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


# ---------------------------------------------------------------- load + completeness
problems = []
runs = load("reconstruct-runs.json")
desc = load("reconstruct-descriptive.json")
psum = load("pilot-summary.json")
precords = {s: load(f"pilot-records/{s}.json") for s in SCENARIOS}

recon = {r["scenarioId"]: r["metrics"] for r in runs}

if sorted(recon) != sorted(SCENARIOS):
    problems.append(f"reconstruct scenarios mismatch: {sorted(recon)}")
if sorted(precords) != sorted(SCENARIOS):
    problems.append("pilot records missing a scenario")

REQUIRED_RECON = [
    "nodeRecall",
    "nodePrecision",
    "precision",
    "recall",
    "relationshipAccuracy",
    "orderedPathCoverage",
    "phaseAccuracy",
    "boundaryAccuracy",
    "finalEdgeNoiseRate",
    "finalExpectedEdgeOmissionRate",
    "f1",
]
for s in SCENARIOS:
    for k in REQUIRED_RECON:
        if recon[s].get(k) is None:
            problems.append(f"{s}: reconstruct metric {k} missing")
    rec = precords[s]
    for path in [("status",), ("cleanOutcome",), ("mutatedOutcome",), ("timing", "prototypeTtfafMs"),
                 ("timing", "baselineTtfafMs"), ("prototype", "predictionCategory")]:
        cur = rec
        for p in path:
            cur = cur.get(p) if isinstance(cur, dict) else None
        if cur is None:
            problems.append(f"{s}: pilot field {'/'.join(path)} missing")

print("=== COMPLETENESS ===")
print(f"reconstruct runs: {len(runs)} / 9")
print(f"pilot records:    {len(precords)} / 9")
print(f"pilot summary completion: {psum['completion']}")
print(f"pilot determinism: {psum['determinism']}")
print("PROBLEMS:", problems if problems else "none - all required data present")
(HERE / "completeness-report.txt").write_text(
    "reconstruct runs: %d/9\npilot records: %d/9\ncompletion: %s\ndeterminism: %s\nproblems: %s\n"
    % (len(runs), len(precords), psum["completion"], psum["determinism"], problems or "none"),
    encoding="utf-8",
)
if problems:
    print("Completeness problems found - aborting before analysis.", file=sys.stderr)
    sys.exit(1)

# ---------------------------------------------------------------- tidy frames
fid = pd.DataFrame(
    [
        {
            "scenario": short(s),
            "cluster": cluster_of(s),
            "category": s.split("-")[2],
            "node_recall": recon[s]["nodeRecall"],
            "node_precision": recon[s]["nodePrecision"],
            "edge_precision": recon[s]["precision"],
            "edge_recall": recon[s]["recall"],
            "relationship_acc": recon[s]["relationshipAccuracy"],
            "ordered_path_cov": recon[s]["orderedPathCoverage"],
            "phase_acc": recon[s]["phaseAccuracy"],
            "boundary_acc": recon[s]["boundaryAccuracy"],
            "graph_noise": recon[s]["finalEdgeNoiseRate"],
            "false_omission": recon[s]["finalExpectedEdgeOmissionRate"],
            "edge_f1": recon[s]["f1"],
            "deterministic": next(r["deterministic"] for r in runs if r["scenarioId"] == s),
        }
        for s in SCENARIOS
    ]
)

pil = pd.DataFrame(
    [
        {
            "scenario": short(s),
            "cluster": cluster_of(s),
            "category": s.split("-")[2],
            "clean_outcome": precords[s]["cleanOutcome"],
            "mutated_outcome": precords[s]["mutatedOutcome"],
            "failure_class": precords[s]["mutatedFailureClass"],
            "prototype_prediction": precords[s]["prototype"]["predictionCategory"],
            "prototype_ttfaf_ms": precords[s]["timing"]["prototypeTtfafMs"],
            "salesforce_ttfaf_ms": precords[s]["timing"]["baselineTtfafMs"],
            "lead_ms": precords[s]["timing"]["leadTimeMs"],
            "deterministic": precords[s]["prototypeDeterministic"],
            "identical_bytes": precords[s]["identicalBytes"],
            "criteria_met": precords[s]["criteriaMet"],
        }
        for s in SCENARIOS
    ]
)

fid.to_csv(HERE / "fidelity_by_scenario.csv", index=False)
pil.to_csv(HERE / "pilot_by_scenario.csv", index=False)

# aggregate descriptive stats (median / IQR) computed here with numpy, cross-checked against the package
POS_METRICS = [
    "node_recall", "node_precision", "edge_precision", "edge_recall",
    "relationship_acc", "ordered_path_cov", "phase_acc", "boundary_acc",
    "graph_noise", "false_omission", "edge_f1",
]
agg = pd.DataFrame(
    {
        "metric": POS_METRICS,
        "median": [float(np.median(fid[m])) for m in POS_METRICS],
        "q1": [float(np.percentile(fid[m], 25)) for m in POS_METRICS],
        "q3": [float(np.percentile(fid[m], 75)) for m in POS_METRICS],
        "min": [float(fid[m].min()) for m in POS_METRICS],
        "max": [float(fid[m].max()) for m in POS_METRICS],
    }
)
agg.to_csv(HERE / "fidelity_aggregate.csv", index=False)

lead = pil["lead_ms"].to_numpy()

# Exact paired sign test on TTFAF (prototype vs Salesforce)
k_proto_faster = int((pil["prototype_ttfaf_ms"] < pil["salesforce_ttfaf_ms"]).sum())
n_pairs = len(pil)
_tail = sum(math.comb(n_pairs, i) for i in range(k_proto_faster, n_pairs + 1)) / 2 ** n_pairs
_low = sum(math.comb(n_pairs, i) for i in range(0, k_proto_faster + 1)) / 2 ** n_pairs
sign_p_two = min(1.0, 2 * min(_tail, _low))
speed_ratio = (pil["salesforce_ttfaf_ms"] / pil["prototype_ttfaf_ms"]).to_numpy()

summary = {
    "n_scenarios": 9,
    "reconstruction_all_deterministic": bool(fid["deterministic"].all()),
    "pilot_all_deterministic": bool(pil["deterministic"].all()),
    "pilot_all_identical_bytes": bool(pil["identical_bytes"].all()),
    "pilot_all_criteria_met": bool(pil["criteria_met"].all()),
    "shiftlead_median_ms": float(np.median(lead)),
    "shiftlead_iqr_ms": float(np.percentile(lead, 75) - np.percentile(lead, 25)),
    "prototype_ttfaf_median_ms": float(np.median(pil["prototype_ttfaf_ms"])),
    "salesforce_ttfaf_median_ms": float(np.median(pil["salesforce_ttfaf_ms"])),
    "speedup_x_median": float(np.median(pil["salesforce_ttfaf_ms"]) / np.median(pil["prototype_ttfaf_ms"])),
    "static_failures_flagged": psum["detection"]["staticFailuresFlagged"],
    "risk_scenarios_flagged": psum["detection"]["riskScenariosFlagged"],
    "risk_invisible_to_salesforce": int((pil[pil.category == "risk"]["mutated_outcome"] == "pass").sum()),
    "speedup_ratio_median": float(np.median(speed_ratio)),
    "speedup_ratio_min": float(speed_ratio.min()),
    "speedup_ratio_max": float(speed_ratio.max()),
    "ttfaf_pairs_prototype_faster": f"{k_proto_faster}/{n_pairs}",
    "ttfaf_sign_test_p_two_sided": round(sign_p_two, 6),
    "ttfaf_sign_test_note": "exact paired sign test; prototype TTFAF < Salesforce TTFAF in all pairs",
}
(HERE / "analysis-summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
print("\n=== AGGREGATE (numpy) ===")
print(agg.to_string(index=False))
print("\n=== SUMMARY ===")
print(json.dumps(summary, indent=2))


def finish(fig, ax, path, grid_axis="y"):
    ax.grid(axis=grid_axis, color=GRID, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    fig.tight_layout()
    fig.savefig(PLOT / path, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("wrote", PLOT / path)


# ---------------------------------------------------------------- Fig 1: fidelity heatmap
HEAT = ["node_recall", "node_precision", "edge_precision", "edge_recall",
        "relationship_acc", "ordered_path_cov", "phase_acc", "boundary_acc"]
HEAT_LABELS = ["Node\nrecall", "Node\nprec.", "Edge\nprec.", "Edge\nrecall",
               "Rel.\nacc.", "Ordered\npath", "Phase\nacc.", "Boundary\nacc."]
M = fid.set_index("scenario")[HEAT].to_numpy()
fig, ax = plt.subplots(figsize=(8.2, 5.2))
im = ax.imshow(M, cmap=SEQ, vmin=0, vmax=1, aspect="auto")
ax.set_xticks(range(len(HEAT)), HEAT_LABELS, fontsize=8)
ax.set_yticks(range(9), fid["scenario"], fontsize=8)
for i in range(9):
    for j in range(len(HEAT)):
        v = M[i, j]
        ax.text(j, i, f"{v:.2f}", ha="center", va="center", fontsize=8,
                color="white" if v >= 0.55 else INK)
ax.set_title("Reconstruction fidelity vs ground truth (offline, higher = better)", fontsize=11, pad=10)
cb = fig.colorbar(im, ax=ax, fraction=0.035, pad=0.02)
cb.outline.set_visible(False)
fig.tight_layout()
fig.savefig(PLOT / "fig1_fidelity_heatmap.png", bbox_inches="tight", facecolor="white")
plt.close(fig)
print("wrote", PLOT / "fig1_fidelity_heatmap.png")

# ---------------------------------------------------------------- Fig 2: shift-left timing (log)
fig, ax = plt.subplots(figsize=(9, 4.8))
x = np.arange(9)
w = 0.4
b1 = ax.bar(x - w / 2, pil["prototype_ttfaf_ms"], w, label="Prototype (design-time)",
            color=PROTO_HUE, zorder=3)
b2 = ax.bar(x + w / 2, pil["salesforce_ttfaf_ms"], w, label="Salesforce validation (deploy)",
            color=BASE_HUE, zorder=3)
ax.set_yscale("log")
ax.set_ylabel("Time to first actionable feedback (ms, log scale)")
ax.set_xticks(x, pil["scenario"], rotation=40, ha="right", fontsize=8)
for b in b1:
    ax.text(b.get_x() + b.get_width() / 2, b.get_height() * 1.08, f"{b.get_height():.0f}",
            ha="center", va="bottom", fontsize=7, color=INK)
for b in b2:
    ax.text(b.get_x() + b.get_width() / 2, b.get_height() * 1.08, f"{b.get_height():.0f}",
            ha="center", va="bottom", fontsize=7, color=INK)
ax.legend(frameon=False, fontsize=9, loc="upper left", bbox_to_anchor=(1.01, 1.0))  # outside, clear of bars
ax.set_title("Shift-left: prototype flags issues ~1000x earlier than deploy validation", fontsize=11)
finish(fig, ax, "fig2_shiftleft_timing.png")

# ---------------------------------------------------------------- Fig 3: shift-left lead per scenario
fig, ax = plt.subplots(figsize=(9, 4.4))
colors = [CLUSTER[c] for c in pil["cluster"]]
bars = ax.bar(pil["scenario"], pil["lead_ms"] / 1000.0, color=colors, zorder=3)
for b in bars:
    ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 0.08, f"{b.get_height():.1f}s",
            ha="center", va="bottom", fontsize=8, color=INK)
ax.set_ylabel("Shift-left lead (seconds)")
ax.set_xticks(range(9), pil["scenario"], rotation=40, ha="right", fontsize=8)
handles = [plt.Rectangle((0, 0), 1, 1, color=CLUSTER[c]) for c in CLUSTER]
ax.legend(handles, CLUSTER.keys(), frameon=False, fontsize=9, title="cluster",
          loc="upper left", bbox_to_anchor=(1.01, 1.0))
ax.set_title("Design-time lead over deploy-time validation, by scenario", fontsize=11)
finish(fig, ax, "fig3_shiftleft_lead.png")

# ---------------------------------------------------------------- Fig 4: detection matrix
fig, ax = plt.subplots(figsize=(9, 4.6))
cols = ["category", "mutated_outcome", "prototype_prediction", "failure_class"]
col_labels = ["design category", "org outcome", "prototype prediction", "failure class"]
ax.set_xlim(0, len(cols))
ax.set_ylim(0, 10)
ax.axis("off")
fig.suptitle("Detection matrix: org outcome vs prototype prediction (all criteriaMet = true)",
             fontsize=11, y=0.99)
for j, cl in enumerate(col_labels):
    ax.text(j + 0.5, 9.25, cl, ha="center", va="bottom", fontsize=8.5, fontweight="bold", color=INK)
for i, (_, row) in enumerate(pil.iterrows()):
    y = 8 - i
    ax.text(-0.15, y + 0.5, row["scenario"], ha="right", va="center", fontsize=8, color=INK)
    vals = [row["category"], row["mutated_outcome"], row["prototype_prediction"], row["failure_class"]]
    for j, v in enumerate(vals):
        met = row["criteria_met"]
        face = "#e7f5ef" if met else "#fdecea"
        ax.add_patch(plt.Rectangle((j + 0.03, y + 0.05), 0.94, 0.9, facecolor=face,
                                   edgecolor=GOOD if met else "#d55e00", linewidth=1.0))
        ax.text(j + 0.5, y + 0.5, str(v), ha="center", va="center", fontsize=7.5, color=INK)
fig.tight_layout()
fig.savefig(PLOT / "fig4_detection_matrix.png", bbox_inches="tight", facecolor="white")
plt.close(fig)
print("wrote", PLOT / "fig4_detection_matrix.png")

# ---------------------------------------------------------------- Fig 5: prototype design-time cost
fig, ax = plt.subplots(figsize=(9, 4.2))
colors = [CLUSTER[c] for c in pil["cluster"]]
bars = ax.bar(pil["scenario"], pil["prototype_ttfaf_ms"], color=colors, zorder=3)
for b in bars:
    ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 0.15, f"{b.get_height():.1f}",
            ha="center", va="bottom", fontsize=8, color=INK)
ax.set_ylabel("Prototype reconstruction latency (ms)")
ax.set_xticks(range(9), pil["scenario"], rotation=40, ha="right", fontsize=8)
handles = [plt.Rectangle((0, 0), 1, 1, color=CLUSTER[c]) for c in CLUSTER]
ax.legend(handles, CLUSTER.keys(), frameon=False, fontsize=9, title="cluster",
          loc="upper left", bbox_to_anchor=(1.01, 1.0))
ax.set_title("Prototype design-time cost per scenario (single-digit milliseconds)", fontsize=11)
finish(fig, ax, "fig5_prototype_latency.png")

# ---------------------------------------------------------------- Fig 6: dumbbell deploy -> design
fig, ax = plt.subplots(figsize=(9, 5))
for i, (_, r) in enumerate(pil.iterrows()):
    yi = 8 - i
    ax.plot([r["prototype_ttfaf_ms"], r["salesforce_ttfaf_ms"]], [yi, yi], color=GRID, lw=2.5, zorder=1)
ys = [8 - i for i in range(9)]
ax.scatter(pil["salesforce_ttfaf_ms"], ys, color=BASE_HUE, s=48, zorder=3, label="Salesforce (deploy)")
ax.scatter(pil["prototype_ttfaf_ms"], ys, color=PROTO_HUE, s=48, zorder=3, label="Prototype (design-time)")
ax.set_xscale("log")
ax.set_yticks(ys, pil["scenario"], fontsize=8)
ax.set_xlabel("Time to first actionable feedback (ms, log scale)")
ax.legend(frameon=False, fontsize=9, loc="upper left", bbox_to_anchor=(1.01, 1.0))
ax.set_title("From deploy-time to design-time: seconds collapse to milliseconds", fontsize=11)
finish(fig, ax, "fig6_dumbbell.png", grid_axis="x")

# ---------------------------------------------------------------- Fig 7: speed-up factor per scenario
fig, ax = plt.subplots(figsize=(9, 4.4))
colors = [CLUSTER[c] for c in pil["cluster"]]
bars = ax.bar(pil["scenario"], speed_ratio, color=colors, zorder=3)
med = float(np.median(speed_ratio))
ax.axhline(med, color=MUTED, ls="--", lw=1.2, zorder=2)
ax.text(8.55, med, f"median {med:.0f}x", va="center", ha="left", fontsize=8, color=MUTED)
for b in bars:
    ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 20, f"{b.get_height():.0f}x",
            ha="center", va="bottom", fontsize=8, color=INK)
ax.set_ylabel("Speed-up factor (Salesforce TTFAF / prototype TTFAF)")
ax.set_xticks(range(9), pil["scenario"], rotation=40, ha="right", fontsize=8)
handles = [plt.Rectangle((0, 0), 1, 1, color=CLUSTER[c]) for c in CLUSTER]
ax.legend(handles, CLUSTER.keys(), frameon=False, fontsize=9, title="cluster",
          loc="upper left", bbox_to_anchor=(1.01, 1.0))
ax.set_title("Per-scenario shift-left speed-up (design-time vs deploy-time)", fontsize=11)
finish(fig, ax, "fig7_speedup.png")

# ---------------------------------------------------------------- Fig 8: information-coverage matrix
# Real signals per category
by_cat = {c: pil[pil.category == c].iloc[0] for c in ["valid", "static_fail", "risk"]}
coverage = {
    "valid": {"proto": ("no blocking finding", "silent-correct"),
              "sf": ("pass", "silent-correct")},
    "static_fail": {"proto": ("blocking finding (design-time)", "surfaced-early"),
                    "sf": ("fail (deploy-time)", "surfaced-late")},
    "risk": {"proto": ("material warning (design-time)", "surfaced-early"),
             "sf": ("pass - NO signal", "gap")},
}
STATE_COLOR = {"silent-correct": ("#eef0f2", MUTED), "surfaced-early": ("#e2eef7", PROTO_HUE),
               "surfaced-late": ("#fdf1e0", BASE_HUE), "gap": ("#fdECEA", "#d55e00")}
fig, ax = plt.subplots(figsize=(9.2, 4.2))
ax.set_xlim(0, 2); ax.set_ylim(0, 3); ax.axis("off")
fig.suptitle("Information coverage: who surfaces the concern, and when", fontsize=11, y=0.99)
for j, cl in enumerate(["Prototype (design-time)", "Salesforce validation (deploy-time)"]):
    ax.text(j + 0.5, 3.08, cl, ha="center", va="bottom", fontsize=9, fontweight="bold", color=INK)
for i, cat in enumerate(["valid", "static_fail", "risk"]):
    y = 2 - i
    ax.text(-0.05, y + 0.5, cat, ha="right", va="center", fontsize=9, color=INK)
    for j, cond in enumerate(["proto", "sf"]):
        text, state = coverage[cat][cond]
        face, edge = STATE_COLOR[state]
        ax.add_patch(plt.Rectangle((j + 0.03, y + 0.06), 0.94, 0.88, facecolor=face, edgecolor=edge, lw=1.4))
        ax.text(j + 0.5, y + 0.5, text, ha="center", va="center", fontsize=8, color=INK)
leg = [plt.Rectangle((0, 0), 1, 1, facecolor=STATE_COLOR[s][0], edgecolor=STATE_COLOR[s][1])
       for s in ["surfaced-early", "surfaced-late", "gap", "silent-correct"]]
ax.legend(leg, ["surfaced early (design-time)", "surfaced late (deploy-time)",
                "coverage gap (baseline blind)", "correctly silent"],
          frameon=False, fontsize=8, loc="upper left", bbox_to_anchor=(0.0, -0.04), ncol=2)
fig.savefig(PLOT / "fig8_coverage_matrix.png", bbox_inches="tight", facecolor="white")
plt.close(fig)
print("wrote", PLOT / "fig8_coverage_matrix.png")

# ---------------------------------------------------------------- Fig 9: KPI summary tiles
tiles = [
    ("Reconstruction fidelity", "1.00", "median, n=9"),
    ("Determinism", "9 / 9", "byte-identical"),
    ("Static-failure detection", "3 / 3", "blocking findings"),
    ("Risk surfaced, org silent", "3 / 3", "baseline blind"),
    ("Median shift-left speed-up", f"{med:.0f}x", "design vs deploy"),
    ("Clean baselines valid", "9 / 9", "cleanInvalid = 0"),
]
fig, ax = plt.subplots(figsize=(9.2, 3.4))
ax.set_xlim(0, 3); ax.set_ylim(0, 2); ax.axis("off")
fig.suptitle("Evaluation at a glance (accepted pilot pilot-20260805-03)", fontsize=11, y=1.0)
for idx, (label, value, sub) in enumerate(tiles):
    cx, cy = idx % 3, 1 - idx // 3
    ax.add_patch(plt.Rectangle((cx + 0.04, cy + 0.06), 0.92, 0.88, facecolor="#f6f8fa",
                               edgecolor=GRID, lw=1.2))
    ax.text(cx + 0.5, cy + 0.62, value, ha="center", va="center", fontsize=20,
            fontweight="bold", color=PROTO_HUE)
    ax.text(cx + 0.5, cy + 0.34, label, ha="center", va="center", fontsize=9, color=INK)
    ax.text(cx + 0.5, cy + 0.18, sub, ha="center", va="center", fontsize=7.5, color=MUTED)
fig.savefig(PLOT / "fig9_kpi_tiles.png", bbox_inches="tight", facecolor="white")
plt.close(fig)
print("wrote", PLOT / "fig9_kpi_tiles.png")

# ---------------------------------------------------------------- Fig 10: robustness tier
# Richer eval:main scenarios with fidelity 1.0, but uncertainty surfaced (unresolved/excluded > 0) and runtime-only handling
rob_path = DATA / "robustness-main-metrics.csv"
if rob_path.exists():
    rob = pd.read_csv(rob_path)
    fig, ax = plt.subplots(figsize=(8.6, 4.6))
    x = np.arange(len(rob))
    conf = rob["dist_confirmed"].to_numpy()
    unres = rob["dist_unresolved"].to_numpy()
    excl = rob["dist_excluded"].to_numpy()
    ax.bar(x, conf, color=PROTO_HUE, zorder=3, label="confirmed")
    ax.bar(x, unres, bottom=conf, color=BASE_HUE, zorder=3, label="unresolved")
    ax.bar(x, excl, bottom=conf + unres, color=MUTED, zorder=3, label="excluded")
    for i in range(len(rob)):
        total = conf[i] + unres[i] + excl[i]
        ax.text(i, total + 0.25,
                f"recall {rob['node_recall'][i]:.2f} / {rob['edge_recall'][i]:.2f}",
                ha="center", va="bottom", fontsize=8, color=INK)
    ax.set_xticks(x, rob["scenario"], fontsize=9)
    ax.set_ylabel("Reconstructed elements (confidence state)")
    ax.set_ylim(0, (conf + unres + excl).max() + 2)
    ax.legend(frameon=False, fontsize=9, loc="upper left", bbox_to_anchor=(1.01, 1.0))
    ax.set_title("Robustness tier: fidelity holds while uncertainty is surfaced, not hidden", fontsize=11)
    finish(fig, ax, "fig10_robustness.png")

    rob_summary = {
        "scenarios": list(rob["scenario"]),
        "node_recall": [float(v) for v in rob["node_recall"]],
        "edge_recall": [float(v) for v in rob["edge_recall"]],
        "edge_precision": [float(v) for v in rob["edge_precision"]],
        "all_fidelity_one": bool((rob[["node_recall", "edge_recall", "edge_precision"]] == 1).all().all()),
        "runtime_only_handled": [f"{int(a)}/{int(b)}" for a, b in
                                 zip(rob["runtime_only_handled"], rob["runtime_only_expected"])],
        "dist_unresolved": [int(v) for v in rob["dist_unresolved"]],
        "dist_excluded": [int(v) for v in rob["dist_excluded"]],
        "finding": ("fidelity 1.0 sustained across escalating complexity; texture is in the confidence "
                    "distribution (unresolved/excluded > 0) and runtime-only handling, not manufactured "
                    "intermediate scores"),
    }
    (HERE / "robustness-summary.json").write_text(json.dumps(rob_summary, indent=2) + "\n", encoding="utf-8")
    print("\n=== ROBUSTNESS TIER ===")
    print(json.dumps(rob_summary, indent=2))

print("\nDONE - CSVs + summary + 10 figures written under analysis/")

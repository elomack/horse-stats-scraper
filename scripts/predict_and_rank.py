#!/usr/bin/env python3
"""
predict_and_rank.py

1) Loads feature vectors for N horses from 'request.json'
2) Normalizes instance types:
   - casts certain fields to strings where required by the model
   - casts numeric string fields to numbers
3) Calls the Vertex AI endpoint to get multiclass probabilities
4) Computes:
   - win_prob   = P(position = 1)
   - place_prob = P(position = 1 or 2)
   - top3_prob  = P(position = 1,2,3)
5) Scales win probabilities to a relative 1–100 score
6) Greedily assigns the top K finish positions (default K=7) among all horses
7) Prints out a comprehensive table and the predicted top K finishers

Usage:
  python predict_and_rank.py [--top_k 7] [--json path/to/request.json]

The script auto-detects the number of horses, and you can ask for top K places out of those.
"""

import json
import argparse
from google.cloud import aiplatform

# ─── CONFIGURATION ───────────────────────────────────────────────────────────
PROJECT_ID  = "horse-racing-predictor-465217"  # your GCP project ID
REGION      = "europe-central2"                # region of your Vertex AI endpoint
ENDPOINT_ID = "2564646056159608832"            # your Vertex AI endpoint ID
# ─── END CONFIGURATION ────────────────────────────────────────────────────────

# Model expects these fields always as strings
STRING_FIELDS = [
    "horse_id",
    "birth_year",
    "total_races",
    "total_wins",
    "total_prize_count",
    "trainer_freq",
    "jockey_weight_missing"  # now casting jockey_weight_missing as string
]

# Fields that must be numeric for the model
NUMERIC_FIELDS = [
    "career_prize",
    "career_win_rate",
    "trainer_win_rate",
    "temperature",
    "track_distance",
    "jockey_weight"
]

# Expected model class labels
CLASS_LABELS = ["1", "2", "3", "4", "5", "6", "7", "other"]


def normalize_instance(instance):
    """
    Convert STRING_FIELDS to str and numeric string fields to numbers.
    """
    # 1) Cast required string fields
    for key in STRING_FIELDS:
        if key in instance:
            instance[key] = str(instance[key])

    # 2) Cast remaining numeric string fields to int/float
    for key in NUMERIC_FIELDS:
        if key in instance:
            val = instance[key]
            if isinstance(val, str):
                try:
                    instance[key] = int(val) if val.isdigit() else float(val)
                except ValueError:
                    pass
    return instance


def load_instances(path):
    """Load and normalize JSON file containing 'instances' or raw array."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    raw = data if isinstance(data, list) else data.get("instances", [])
    return [normalize_instance(inst) for inst in raw]


def call_endpoint(instances):
    """Call the Vertex AI endpoint and return raw predictions."""
    aiplatform.init(project=PROJECT_ID, location=REGION)
    endpoint = aiplatform.Endpoint(endpoint_name=ENDPOINT_ID)
    response = endpoint.predict(instances=instances)
    return response.predictions


def compute_metrics(predictions):
    """Compute win/place/top3 probabilities from raw scores."""
    results = []
    for pred in predictions:
        scores = pred.get("scores", [])
        class_probs = {lbl: scores[idx] for idx, lbl in enumerate(CLASS_LABELS)}
        win_prob = class_probs.get("1", 0.0)
        place_prob = win_prob + class_probs.get("2", 0.0)
        top3_prob = place_prob + class_probs.get("3", 0.0)
        results.append({
            "class_probs": class_probs,
            "win_prob": win_prob,
            "place_prob": place_prob,
            "top3_prob": top3_prob,
        })
    return results


def scale_scores_to_rank(win_probs):
    """Scale win probabilities to a 1–100 relative rank."""
    if not win_probs:
        return []
    min_p, max_p = min(win_probs), max(win_probs)
    ranks = []
    for p in win_probs:
        if max_p == min_p:
            ranks.append(100)
        else:
            scaled = 1 + (p - min_p) * 99 / (max_p - min_p)
            ranks.append(round(scaled))
    return ranks


def predict_top_k(metrics, top_k):
    """Greedily pick top_k finishers based on class_probs."""
    chosen = set()
    ranking = []
    for pos in range(1, min(top_k, len(metrics)) + 1):
        label = str(pos)
        best_idx, best_prob = None, -1.0
        for idx, m in enumerate(metrics):
            if idx in chosen:
                continue
            prob = m.get("class_probs", {}).get(label, 0.0)
            if prob > best_prob:
                best_prob, best_idx = prob, idx
        if best_idx is not None:
            chosen.add(best_idx)
            ranking.append((pos, best_idx, best_prob))
    return ranking


def main():
    parser = argparse.ArgumentParser(description="Predict and rank horses.")
    parser.add_argument("--json", default="request.json", help="Path to JSON file.")
    parser.add_argument("--top_k", type=int, default=7, help="Top K finishers to predict.")
    args = parser.parse_args()

    instances = load_instances(args.json)
    if not instances:
        print("No instances loaded; check your JSON file.")
        return
    print(f"Loaded {len(instances)} horses from {args.json}")

    predictions = call_endpoint(instances)
    metrics = compute_metrics(predictions)
    win_probs = [m['win_prob'] for m in metrics]
    place_probs = [m['place_prob'] for m in metrics]
    top3_probs = [m['top3_prob'] for m in metrics]
    rel_ranks = scale_scores_to_rank(win_probs)

    # Print table header
    print(f"{'Idx':<4} {'Win%':>6} {'Place%':>7} {'Top3%':>7} {'Rank':>5}")
    print('-'*34)
    for idx, (w, pla, t3, rr) in enumerate(zip(win_probs, place_probs, top3_probs, rel_ranks), start=1):
        print(f"{idx:<4} {w*100:>5.1f}% {pla*100:>6.1f}% {t3*100:>6.1f}% {rr:>5}")

    ranking = predict_top_k(metrics, args.top_k)
    print(f"\nPredicted top {min(args.top_k, len(instances))} finishers:")
    for pos, hidx, prob in ranking:
        print(f"  {pos} → Horse #{hidx+1} ({prob*100:.1f}%)")

if __name__ == "__main__":
    main()

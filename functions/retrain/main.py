# functions/retrain/main.py

from datetime import datetime
from google.cloud import aiplatform

# Initialize Vertex AI once at cold start
aiplatform.init(
    project="horse-racing-predictor-465217",
    location="europe-central2"
)

def retrain(request):
    """
    HTTP-triggered function to launch or dry-run a weekly AutoML training job.
    Use ?dry_run=true to preview without billing.
    """
    # 1) Build the snapshot table path
    date_suffix = datetime.utcnow().strftime("%Y%m%d")
    bq_table = (
        f"bq://horse-racing-predictor-465217.horse_racing_data."
        f"training_data_multiclass_snapshot_{date_suffix}"
    )

    # 2) Dry-run check
    if request.args.get("dry_run", "").lower() == "true":
        return (f"[DRY RUN] Would launch training on {bq_table}", 200)

    # 3) Configure & launch real training
    job = aiplatform.AutoMLTabularTrainingJob(
        display_name=f"weekly-horse-retrain-{date_suffix}",
        optimization_prediction_type="classification",
        optimization_objective="maximize-roc-auc"
    )
    job.run(
        dataset=bq_table,
        target_column="position_class",
        model_display_name=f"horse_predictor_{date_suffix}",
        budget_milli_node_hours=1000,  # 1 node-hour
        sync=False,
    )

    return (f"Launched training job for snapshot {date_suffix}", 200)

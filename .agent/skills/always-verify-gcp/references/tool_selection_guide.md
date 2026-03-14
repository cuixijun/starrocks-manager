# GCP CLI Tool Selection Guide

When a user requests an action on a Google Cloud resource, the first step is to select the most appropriate command-line tool. Do not default to `gcloud` for all tasks.

## Heuristics for Tool Selection

Use the following rules to determine the correct tool:

1.  **For BigQuery:**
    *   **Tool:** `bq`
    *   **Reason:** The `bq` tool is the native, most direct, and feature-rich CLI for all BigQuery operations, including creating datasets (`mk`), loading data (`load`), and running queries (`query`).

2.  **For Google Cloud Storage:**
    *   **Tool:** `gsutil`
    *   **Reason:** The `gsutil` tool is the native, most direct, and feature-rich CLI for all Cloud Storage operations, including creating buckets (`mb`), managing IAM policies (`iam`), and copying files (`cp`).

3.  **For All Other Services:**
    *   **Tool:** `gcloud`
    *   **Reason:** `gcloud` is the primary, unified CLI for the vast majority of other Google Cloud services, including but not limited to:
        *   Compute Engine (VMs, Disks)
        *   Google Kubernetes Engine (GKE)
        *   Cloud SQL
        *   Identity and Access Management (IAM)
        *   App Engine
        *   Cloud Functions

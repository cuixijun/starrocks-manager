# GCP Error Handling Playbook

This guide provides instructions for diagnosing and resolving common errors encountered when running GCP commands.

## General Error Handling Flow

1.  If a command executed via `run_shell_command` returns a non-zero exit code, retrieve the full error message from the output.
2.  Analyze the error message to see if it matches any of the known patterns below.
3.  If a pattern is matched, follow its specific resolution steps.
4.  If no pattern is matched, report the full error to the user and ask for guidance.

---

## Error Pattern: Permission Denied

### 1. Identification

This pattern is matched if the command output contains any of the following substrings:

*   `PERMISSION_DENIED`
*   `does not have permission`
*   `permission(s) required`
*   `403` (in the context of an API error)

### 2. Diagnosis and Resolution Steps

1.  **Parse the Error:** Carefully read the error message to identify the specific permission that is missing (e.g., `compute.instances.delete`).

2.  **Query the MCP Server:** Use the `search_documents` tool to find the official documentation for the required permission. Use a query like:
    *   `"Google Cloud IAM role for [permission]"` (e.g., `"Google Cloud IAM role for compute.instances.delete"`)
    *   `"predefined IAM roles for [service]"` (e.g., `"predefined IAM roles for Compute Engine"`)

3.  **Identify the Role:** From the documentation, identify the name of one or more predefined IAM roles that grant the required permission (e.g., `roles/compute.admin`).

4.  **Report and Suggest:** Inform the user of the specific permission they are missing and suggest the identified role as a solution. For example:
    > "The command failed with a permission error. It appears the user or service account is missing the `compute.instances.delete` permission. Granting the `Compute Admin` (`roles/compute.admin`) role on the project should resolve this."

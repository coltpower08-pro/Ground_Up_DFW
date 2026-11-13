# One-time setup: let GitHub Actions in coltpower08-pro/Ground_Up_DFW deploy to Firebase project ground-up-dfw without a key file.
# Paste into Google Cloud Shell (console.cloud.google.com, the >_ button at the top right). Safe to run more than once.
PROJECT=ground-up-dfw
REPO=coltpower08-pro/Ground_Up_DFW
SA=github-deploy@$PROJECT.iam.gserviceaccount.com
gcloud config set project $PROJECT
echo "== Turning on the Google services the deploy uses"
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com firebasehosting.googleapis.com firestore.googleapis.com firebaserules.googleapis.com cloudresourcemanager.googleapis.com serviceusage.googleapis.com
echo "== Deploy account"
gcloud iam service-accounts describe $SA >/dev/null 2>&1 || gcloud iam service-accounts create github-deploy --display-name="GitHub deploy"
for ROLE in roles/firebase.admin roles/serviceusage.serviceUsageConsumer roles/serviceusage.apiKeysViewer; do
  gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SA" --role="$ROLE" --condition=None --quiet >/dev/null && echo "   granted $ROLE"
done
echo "== Trust link between GitHub and Google"
gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 || gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"
gcloud iam workload-identity-pools providers describe ground-up-repo --location=global --workload-identity-pool=github >/dev/null 2>&1 || gcloud iam workload-identity-pools providers create-oidc ground-up-repo --location=global --workload-identity-pool=github --display-name="Ground_Up_DFW repo" --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" --attribute-condition="assertion.repository=='$REPO'"
NUM=$(gcloud projects describe $PROJECT --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding $SA --role=roles/iam.workloadIdentityUser --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" --quiet >/dev/null && echo "   only $REPO may deploy as $SA"
echo "== ALL DONE (project number $NUM)"

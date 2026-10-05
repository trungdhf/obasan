# Deploy guide — Cloud Run + Firestore + Scheduler + LINE

Everything below assumes a GCP project with billing. Set it once:

```bash
export PROJECT_ID=your-gcp-project
export REGION=asia-northeast1
gcloud config set project $PROJECT_ID
```

## 1. Enable APIs

```bash
gcloud services enable run.googleapis.com firestore.googleapis.com \
  cloudscheduler.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com \
  aiplatform.googleapis.com
```

> **Vertex AI** (`aiplatform`) is what the hackathon's Google Cloud credits pay
> for — with `GOOGLE_CLOUD_PROJECT` set, the backend runs Gemini Live + TTS
> through Vertex using the Cloud Run service account, and no Gemini API key is
> needed at all.

Create Firestore (Native mode) once in the console or:

```bash
gcloud firestore databases create --location=$REGION
```

## 2. Secrets

```bash
echo -n "$LINE_CHANNEL_SECRET"     | gcloud secrets create line-secret      --data-file=-
echo -n "$LINE_CHANNEL_TOKEN"      | gcloud secrets create line-token       --data-file=-
echo -n "$(openssl rand -hex 24)"  | gcloud secrets create job-secret       --data-file=-
```

(Gemini needs no secret in Vertex mode. If you also want AI-Studio fallback,
store `GEMINI_API_KEY` the same way — Vertex wins when the project is set.)

## 3. Deploy Cloud Run

```bash
gcloud run deploy hinata \
  --source . \
  --region $REGION \
  --allow-unauthenticated \
  --timeout 3600 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=us-central1,QUIET_HOURS=22-7,IDLE_TO_STANDY_SEC=45" \
  --set-secrets "LINE_CHANNEL_SECRET=line-secret:latest,LINE_CHANNEL_ACCESS_TOKEN=line-token:latest,JOB_SECRET=job-secret:latest"
```

> `--timeout 3600` keeps the SSE stream (tablet ← backend events) alive past
> the 300s default; the page auto-reconnects anyway but long timeouts are
> smoother. Omit `--set-secrets` if you haven't created LINE secrets yet —
> the app runs fine and logs family alerts instead.

> `GOOGLE_CLOUD_LOCATION` is the Vertex region used for **TTS** — `us-central1`
> is the safest choice. **Gemini Live runs on the `global` Vertex endpoint**
> (model `gemini-live-2.5-flash`; regional Live publisher models are not
> served — verified 2026-10). Override with `VERTEX_LIVE_LOCATION` only if a
> regional Live model works in your region. `asia-northeast1` is a good choice
> for the Cloud Run service itself (Run/Firestore/Scheduler are all regional).

`--source .` builds the root `Dockerfile` (build context = repo root; the
image needs both `backend/` and `web/`).

> Note the Cloud Run service account needs `aiplatform.user` (Vertex Live/TTS),
> `datastore.user` (Firestore) and `secretmanager.secretAccessor` on the secrets.
> Grant once:
> ```bash
> SA=$(gcloud run services describe hinata --region $REGION --format='value(spec.template.spec.serviceAccountName)')
> gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$SA" --role=roles/aiplatform.user
> gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$SA" --role=roles/datastore.user
> ```

Grab the URL: `gcloud run services describe hinata --region $REGION --format='value(status.url)'`

## 4. Cloud Scheduler (reminders, every minute)

```bash
gcloud scheduler jobs create http hinata-due \
  --location=$REGION --schedule="* * * * *" --time-zone="Asia/Tokyo" \
  --uri="$URL/jobs/due" --http-method=POST \
  --headers="x-job-secret=$(gcloud secrets versions access latest --secret=job-secret)"
```

## 5. LINE Messaging API

1. LINE Developers console → create a provider + **Messaging API** channel.
2. Channel secret → `line-secret`, long-lived channel access token → `line-token`.
3. Webhook URL: `https://<URL>/webhook/line`, enable "Use webhook".
4. Add the bot to the family group (or get grandma's children userIds) and put
   the target ID(s) in `LINE_TARGET_IDS` (group ID starts with `C`, user `U`).
5. Redeploy or update env vars.

## 6. Auto-deploy on git push (continuous deployment)

After the first manual deploy, Cloud Run can rebuild + redeploy on every push
to `main` — no more `gcloud run deploy` by hand. One-time setup (console,
because it needs your GitHub OAuth):

1. Merge the working branch into `main` — the trigger watches `main`.
2. Console → **Cloud Run** → `hinata` → **"Set up continuous deployment"**
   (or Edit & deploy new revision → "Continuously deploy new revisions from
   a source repository").
3. Authenticate GitHub → pick repo `trungdhf/obasan` → branch `^main$`.
4. Build type: **"Cloud Build configuration file"** → `cloudbuild.yaml`
   (already in the repo — builds the root Dockerfile and swaps the image,
   keeping env vars/secrets). Alternatively pick **Dockerfile** — same result.
5. Save — the console creates the Cloud Build trigger and grants its service
   account `run.admin` + `iam.serviceAccountUser` for you. Approve that prompt.

Every `git push` to `main` now rebuilds and deploys in ~4–5 min. Check builds
under Cloud Run → hinata → "Revisions" or Cloud Build → History.

> Don't point the trigger at a dev branch — anything pushed to `main` goes
> live immediately.

## 7. Tablet kiosk

- Chrome → Settings → open `https://<URL>` → "Add to Home screen", or Android
  kiosk mode (`chrome --kiosk <URL>` / managed kiosk policy).
- First tap on 「はじめる」 unlocks audio, camera and mic permissions.
- The page requests a screen Wake Lock; keep the tablet plugged in.

## Env reference

See `backend/.env.example`. Minimum for the real experience (Vertex mode):
`GOOGLE_CLOUD_PROJECT`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`,
`LINE_TARGET_IDS`, `JOB_SECRET` — plus `aiplatform.user` on the service account.
`GEMINI_API_KEY` is only needed for AI-Studio local dev without GCP.

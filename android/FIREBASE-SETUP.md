# Setting up Firebase for the Android app's notifications

The Android app shows the site in its own WebView, which has no Web Push. So its notifications
come through **Firebase Cloud Messaging (FCM)**, Google's push service for Android. There are
three kinds, all turned on in the app's alerts window (the bell in the Edge Tray):

| Notification | Sent by | To |
|---|---|---|
| **PSI alerts**: "PSI is unhealthy in the West", when the 24-hour PSI where you picked reaches your level, changes band above it, or eases back. The same alerts the website sends by Web Push | This site's collect cron, every 5 minutes (`main-site/api/_push/notify.js`) | Each phone, by its FCM token, kept with its choice in Upstash like a browser's subscription |
| **Morning summary**: "PSI this morning: 45–58, good", at 7am | This site's morning cron (`main-site/api/cron/morning.js`) | The FCM topic `sgpsi-morning` |
| **New versions of the app**: "Version 1.0.1 of SG PSI is out", the moment you publish a release. Tapping it opens the update window | This site's server (`main-site/api/push/release.js`), called by a GitHub webhook | The FCM topic `sgpsi-releases` |

A phone joins a topic when its switch is turned on, so the server keeps no list of phones for
those. The topics carry the `sgpsi-` prefix because topics are shared by every app in a
Firebase project.

SG PSI goes into your existing **UwU Apps** Firebase project, as an app of its own, beside SG
Bus Timings and uwuHere. Only FCM is used: no Analytics, no Firebase database, nothing else.
It's free.

Until this is done, the app works fully, but has no notifications: the alerts window says
this copy of the app can't get alerts, and the two switches stay hidden.

It takes about 20 minutes, and covers four things:

| What | Where it goes | Secret? |
|---|---|---|
| `google-services.json`, which tells the app which Firebase project it belongs to | `android/native/app/` | No, but kept out of git anyway |
| SG PSI's service account key (`….json`), which lets this site's server send pushes | Vercel, as `FIREBASE_SERVICE_ACCOUNT` | **Yes.** Anyone with it can push to phones with any app in the UwU Apps project |
| A webhook secret, which proves a "release published" call really came from GitHub | GitHub and Vercel, as `GITHUB_WEBHOOK_SECRET` | **Yes** |
| A GitHub token (optional), which raises GitHub's rate limit for the update check | Vercel, as `GITHUB_TOKEN` | Yes, though it can do nothing but read |

The first is all the app needs. Without the second, the switches work but nothing is ever
sent; without the third, PSI alerts and the morning summary still arrive, but not new versions.

## 1. Add SG PSI to the UwU Apps project, and get `google-services.json`

1. Open <https://console.firebase.google.com> and pick the **UwU Apps** project.
2. Click the gear by **Project Overview**, then **Project settings** > **Your apps** > **Add
   app** > **Android**.
3. **Android package name**: `org.uwuapps.sgpsi`. It has to be exactly this.
4. **App nickname**: `SG PSI`. Leave **Debug signing certificate SHA-1** empty, since FCM
   doesn't need it.
5. Click **Register app**.
6. Click **Download google-services.json**. Save it as
   `android\native\app\google-services.json` in this project, beside `build.gradle`.
7. Click **Next** through the remaining steps without changing anything. The project already
   has what they describe: the build applies the Google services plugin whenever the file is
   there.

The file lists every app in the project, and the build takes the `org.uwuapps.sgpsi` entry from
it. Download it **after** registering SG PSI, or the build stops with "No matching client found
for package name".

It's kept out of git by `android/.gitignore` and the root `.gitignore`. `git status` won't list
it; if it ever does, don't commit it.

## 2. Check FCM's API is on

This should already be done for SG Bus Timings and uwuHere. In Firebase, open **Project
settings** > **Cloud Messaging**. Under **Firebase Cloud Messaging API (V1)** it should say
**Enabled**.

## 3. Make SG PSI's own service account key

The key comes from Google Cloud, where Firebase projects live. It belongs to SG PSI alone, so it
can be deleted without touching the other apps' keys.

1. Open <https://console.cloud.google.com/iam-admin/serviceaccounts>. At the top, pick the
   **UwU Apps** project.
2. Click **Create service account**:
   - **Service account name**: `sgpsi-push`
   - **Description**: `SG PSI's server, sending notifications through FCM`
   - Click **Create and continue**.
3. Under **Grant this service account access to project**, in **Select a role**, search for
   `Firebase Cloud Messaging API Admin` and pick it. Pick only this one. Click **Continue**,
   then **Done**.
4. In the list, click `sgpsi-push@…`, open the **Keys** tab, and click **Add key** >
   **Create new key** > **JSON** > **Create**. A `.json` file downloads.

> [!WARNING]
> That key is a password. Don't commit it, email it, or paste it anywhere but Vercel. FCM
> doesn't fence a key to one app, so a leaked key can push to every app in UwU Apps. If it ever
> leaks, delete it on the same **Keys** tab and make a new one.

## 4. Give the server its secrets (Vercel)

Open <https://vercel.com>, then the project that serves sgpsi.uwuapps.org, then **Settings** >
**Environment Variables**. Add each of these with **Production** ticked (and **Preview** if you
test there), and mark each **Sensitive**:

| Key | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Open the key file from step 3 in Notepad and paste **everything** in it, from `{` to `}`. Base64 of the file works too |
| `GITHUB_WEBHOOK_SECRET` | A long random string. Make one in PowerShell with the command below, and keep it for step 5 |
| `GITHUB_TOKEN` (optional) | A GitHub fine-grained token with **Public repositories (read-only)** access and nothing else, from <https://github.com/settings/personal-access-tokens/new>. Without it, GitHub allows 60 update checks an hour, which the site's 10-minute cache of the answer makes plenty |

```powershell
$b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { '{0:x2}' -f $_ })
```

PSI alerts to the app also need what the website's alerts already use: the Upstash store
(`KV_REST_API_URL`, `KV_REST_API_TOKEN`) and `CRON_SECRET` (`main-site/README.md`). The VAPID
keys are only for browsers.

Then redeploy so the functions see them: open **Deployments**, then the newest deployment's
**⋯** menu, then **Redeploy**. After that, delete the downloaded key file from your Downloads
folder, since Vercel has it now.

## 5. Tell GitHub to call the server when you publish a release (webhook)

1. Open <https://github.com/augy-studios/sg-psi/settings/hooks/new>.
2. Fill it in:
   - **Payload URL**: `https://sgpsi.uwuapps.org/api/push/release`
   - **Content type**: `application/json`. It has to be this one.
   - **Secret**: the same `GITHUB_WEBHOOK_SECRET` as in Vercel.
   - **Which events would you like to trigger this webhook?**: pick **Let me select individual
     events**, untick **Pushes**, and tick **Releases**.
   - **Active**: ticked.
3. Click **Add webhook**. GitHub sends a test ping straight away. Under **Recent Deliveries** it
   should show a green tick and the response `{"ok":true,"pong":true}`. A 401 response means
   the secret doesn't match Vercel's (or Vercel hasn't been redeployed since).

From now on, publishing an `android-v*` release with its APK attached pushes the notification
(`release/README.md`). Drafts, pre-releases and releases without an APK are skipped, and so is
re-publishing a version older than the newest. **Recent Deliveries** shows each answer, with
the reason when nothing was sent.

## 6. Build the app with Firebase in it

```powershell
powershell -ExecutionPolicy Bypass -File android\build-apk.ps1
```

The build picks up `google-services.json` by itself, and says
`Firebase: google-services.json found, notifications included.` Install the new APK on your
phone.

## 7. Check it works

1. **PSI alerts**: in the app, open the bell in the Edge Tray, pick an area and a level, and tap
   **Turn alerts on**. When Android asks to allow notifications, tap **Allow**. Then tap **Send
   test alert**, and lock the phone: "Test alert from SG PSI" arrives within seconds.
2. **Where I am**: pick **Where I am** as the area. Android asks for location: allow it, then
   on the next screen choose **Allow all the time**. The note under the buttons names the
   region you're in.
3. **Morning summary**: turn on **Morning summary**. Rather than waiting for 7am, open the
   Vercel project's **Settings** > **Cron Jobs** and press **Run** beside `/api/cron/morning`.
   It arrives within a minute.
4. **New versions**: turn on **New versions of the app**. Without making a release, open the
   webhook in GitHub, go to **Recent Deliveries**, and redeliver a past `release` delivery. Or
   wait for your next release.

## If something goes wrong

| What happens | What to do |
|---|---|
| The build stops with `No matching client found for package name 'org.uwuapps.sgpsi'` | `google-services.json` was downloaded before SG PSI was added. Download it again from **Project settings** > **Your apps** > **SG PSI**. |
| "This copy of the app can't get alerts" | The APK was built without `google-services.json`. Check it's at `android\native\app\google-services.json`, then build again and reinstall. |
| "Notifications are off for SG PSI in Android's settings" | You said no to Android's prompt. Tap **Open Android's settings**, turn notifications on, and come back. |
| "Couldn't reach Firebase" when turning a switch on | The phone was offline, or has no Google Play services (some Huawei phones), which FCM needs. |
| **Send test alert** says `FIREBASE_SERVICE_ACCOUNT is missing` | Step 4 is missing or wasn't redeployed. |
| **Send test alert** says sent, but nothing arrives | Check the app's notifications aren't off in Android's settings, or held back by Do Not Disturb. The function logs for `/api/push/devices/[id]` show FCM's answer if it turned the push away. |
| The morning cron answers `FCM responded 403` | The service account is missing its role (step 3.3), or FCM's API is off (step 2). |
| The webhook shows `401 Bad signature` | The secret in GitHub and `GITHUB_WEBHOOK_SECRET` in Vercel differ, or Vercel wasn't redeployed after adding it. |
| The webhook shows `502` with `FIREBASE_SERVICE_ACCOUNT is not set` | Step 4 is missing or wasn't redeployed. |
| The webhook or cron shows `Google token responded 400: invalid_grant` | The key was deleted. Make a new one (step 3.4), replace the variable, and redeploy. |
| The webhook shows `400 Not JSON` | The webhook's content type is `application/x-www-form-urlencoded`. Edit it to `application/json`. |

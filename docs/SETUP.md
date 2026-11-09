# Setting it up (one time, about 45 minutes)

You need four free accounts: **a new Gmail address** for the alerts, **Supabase** (the database), **Netlify** (the website),
and the GitHub account you already have. Keys and passwords go only into those services' settings pages, never into
the code or a chat.

## 1. The scheduled check: already running in test mode
GitHub runs the check every 3 hours (`.github/workflows/monitor.yml`). Until steps 2 to 4 are done, it reads the
**simulated test mailbox** and saves its results in the `monitor-data` branch. To watch it: GitHub, then **Actions**,
then **Property monitor**. Each run shows a summary. **Run workflow** starts one straight away.

## 2. The alert inbox
1. Create a new Gmail account just for property alerts, e.g. `deeside.alerts.yourname@gmail.com`.
2. In that account turn on **2-Step Verification** (Google Account, Security).
3. Create an **app password** (Google Account, Security, App passwords). Name it "Deeside Property Watch" and copy the 16 letters.
4. In GitHub open the repository, then **Settings**, **Secrets and variables**, **Actions**, **New repository secret**, and add:
   - `IMAP_USER`: the new Gmail address
   - `IMAP_PASSWORD`: the app password
   - optional `DIGEST_TO`: your usual email address, to get a short summary whenever something changes

## 3. Point the portals' alerts at that inbox
Sign up on each site **with the new Gmail address** and create a saved search with email alerts set to **instant**
(or the most frequent option). Use Torphins with a radius that covers Banchory, Aboyne, Ballater, Kincardine O'Neil and
Lumphanan (about 15 miles), or one search per town.
- **ASPC**: saved search with email alerts.
- **Rightmove**: create an alert ("Instantly"). Also **save** (heart) properties you want to follow closely, and turn on any update emails Rightmove offers for saved properties.
- **Zoopla**: save the search, then turn on email alerts (and price-reduction alerts if offered).
- **OnTheMarket**: create an alert.
- Optional: ESPC, S1homes, and local estate agents' and solicitors' own email alerts. Anything sent to the inbox with listing links is read.

## 4. The database (Supabase, free)
1. Create a project at supabase.com (region: London).
2. **SQL Editor**: paste `supabase/schema.sql`. Replace `YOUR-EMAIL@EXAMPLE.COM` with the address you will log in with, then press **Run**.
3. **Project Settings, API keys**: copy the **Project URL**, the **publishable** key and a **secret** key.
4. Add the GitHub secrets `SUPABASE_URL` (Project URL) and `SUPABASE_SECRET_KEY` (secret key). The secret key never goes anywhere else.

## 5. The website (Netlify, free)
1. At netlify.com: **Add new site**, **Import from GitHub**, then choose this repository. The build settings come from `netlify.toml`.
2. **Site configuration, Environment variables**: add `VITE_SUPABASE_URL` (Project URL) and `VITE_SUPABASE_PUBLISHABLE_KEY` (the publishable key, which is safe in a website), then redeploy.
3. In Supabase, **Authentication, URL Configuration**: set the Site URL to your Netlify address and add it to the Redirect URLs.
4. In GitHub, **Settings, Secrets and variables, Actions, Variables**: add `APP_URL` with the Netlify address, so summary emails link to it.

## 6. Use it on your Mac and iPhone
Open the Netlify address, enter your email and open the sign-in link. On iPhone, in Safari: **Share**, then **Add to Home Screen**.

## 7. Switch off test mode
Once real alerts are arriving, add the GitHub **variable** `SIMULATION` with value `off`. Then, on the Monitoring page, press
**Remove simulated test data**.

## Optional: try a data provider
Start a PaTMa (500 free credits) or Homedata trial and tell me. I will ask for the key through a secure form (never by chat),
test coverage for Torphins, Banchory, Aboyne and Ballater, and report back before you pay for anything.

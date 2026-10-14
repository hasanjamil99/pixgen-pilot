<p align="center"><img src="brand/pixgenpilot-mark.svg" alt="PixGen Pilot" height="72"></p>

<h1 align="center">PixGen Pilot</h1>

<p align="center"><b>Your Facebook Page, on autopilot, in Bangla.</b><br>
A self-hosted app: Gemini writes a Bangla post, PixGen Pilot renders a branded 1080×1080 banner, and both are published to your Facebook Pages on a schedule.</p>

<p align="center">
  <a href="#quick-start-with-docker-recommended">Quick start</a> ·
  <a href="#step-by-step-first-setup">First setup</a> ·
  <a href="#create-your-facebook-app">Facebook App</a> ·
  <a href="#run-it-on-a-server-with-your-own-domain">Deploy</a> ·
  <a href="#troubleshooting">Troubleshooting</a>
</p>

---

## What it does

- **Daily posts, hands off.** Each Facebook Page gets its own cron schedule. On time, PixGen Pilot picks a topic, writes the post with Gemini, renders the banner and publishes it.
- **Multiple Pages.** Every Page has its own niche, brand name/handle/logo, colours, banner style, schedule, queue and history.
- **Bangla-first writing.** Gemini returns strict JSON (topic, badge, headline, sub-headline, caption). If English slips in, it is asked again.
- **Branded banners.** Puppeteer renders 1080×1080 PNGs with Bangla fonts. Choose templates (headline, quote, tips), upload your own background or a sample design to match, rotate brand backgrounds, or use free Pexels stock photos.
- **Plan ahead.** Post ideas (auto-researched from your page and competitors), a content queue, and a month planner with optional approval before anything goes live.
- **Continue with Facebook.** Log in with Facebook, tick your Pages, done. Page tokens are long-lived and stored encrypted.
- **Safe by default.** API keys and tokens are encrypted in MySQL (AES-256-GCM) and only ever shown masked. Failed posts are kept and can be retried without calling Gemini again.
- **Single owner.** One login (yours), no public sign-up.

**Stack:** Node.js 20+ · Express 5 · MySQL 8 · Puppeteer (Chromium) · Google Gemini · React 19 + Vite + Tailwind CSS 4.

---

## What you need

| | Where to get it | Cost |
| --- | --- | --- |
| A computer or server that runs **Docker** (easiest), or **Node.js 20+** and **MySQL 8** | [docker.com/get-started](https://www.docker.com/get-started/) | Free |
| A **Gemini API key** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Free Trial Available |
| A **Facebook App** (for "Continue with Facebook") | [developers.facebook.com/apps](https://developers.facebook.com/apps). See [Create your Facebook App](#create-your-facebook-app) | Free |
| Admin access to the **Facebook Page(s)** you want to post to | | |
| *Optional:* a **Pexels API key** for free stock photos | [pexels.com/api](https://www.pexels.com/api/) | Free |
| *For a server:* a **domain name** pointing at it (Facebook login needs HTTPS) | Any registrar | |

---

## Quick start with Docker (recommended)

Docker runs the app **and** its MySQL database for you, with Chromium and Bangla fonts already inside the image.

```bash
# 1. Get the code
git clone https://github.com/hasanjamil99/pixgen-pilot.git
cd pixgen-pilot

# 2. Create your settings file
cp .env.example .env
```

3. Open `.env` in a text editor and fill in at least these values:

   | Setting | What to put |
   | --- | --- |
   | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The email and password you will log in with |
   | `SESSION_SECRET`, `SECRETS_KEY` | Two different random strings. Run `openssl rand -hex 32` twice and paste the results |
   | `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD` | Two different strong passwords for the database (you won't need to type them anywhere else) |
   | `PUBLIC_URL` | `http://localhost:3000` on your own computer, or `https://your-domain.com` on a server |
   | `TIMEZONE` | Your timezone, e.g. `Asia/Dhaka`, `Europe/London`, `America/New_York` |

   > **Keep `SECRETS_KEY` safe and never change it.** It encrypts your stored keys and tokens; if it changes they can't be read any more.

4. Start it:

   ```bash
   docker compose up -d --build
   ```

   The first build takes a few minutes. Watch the logs with `docker compose logs -f app` until you see the dashboard address.

5. Open **http://localhost:3000** (or your domain) and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

Then follow [Step-by-step first setup](#step-by-step-first-setup).

---

## Run without Docker

You need **Node.js 20+** and a **MySQL 8** server.

1. Create a database user (in the MySQL shell):

   ```sql
   CREATE DATABASE fb_autopilot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'pixgen'@'localhost' IDENTIFIED BY 'choose-a-strong-password';
   GRANT ALL PRIVILEGES ON fb_autopilot.* TO 'pixgen'@'localhost';
   ```

   (On Linux, use `'pixgen'@'127.0.0.1'` if your MySQL treats TCP and socket logins separately.)

2. Install and configure:

   ```bash
   git clone https://github.com/hasanjamil99/pixgen-pilot.git
   cd pixgen-pilot
   npm install                # also downloads Chrome for Puppeteer
   cp .env.example .env       # fill in ADMIN_*, SESSION_SECRET, SECRETS_KEY and DB_* (MYSQL_ROOT_PASSWORD is not needed)
   ```

3. Build the dashboard, check banners work, and start:

   ```bash
   npm run build              # builds the React dashboard
   npm run test-banner        # renders public/banners/test-banner.png (checks Bangla fonts, no database needed)
   npm start                  # http://localhost:3000
   ```

Tables are created and upgraded automatically on every start. To keep it running after you close the terminal, use a process manager such as [pm2](https://pm2.keymetrics.io/) (`pm2 start src/index.js --name pixgen-pilot`) or a systemd service.

**Linux servers without Docker:** Chromium needs a few system libraries and a Bangla font. On Debian/Ubuntu: `sudo apt install chromium fonts-noto-core fonts-beng fonts-noto-color-emoji`, then set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` in `.env`.

---

## Step-by-step first setup

After you sign in for the first time:

1. **Platform settings → Facebook App.** Paste your Facebook **App ID** and **App Secret** ([how to create the app](#create-your-facebook-app)). This screen also shows the exact *Valid OAuth Redirect URI* to copy into Facebook.
2. **Platform settings → Pexels** *(optional).* Paste a Pexels key to use free stock photos as banner backgrounds.
3. **Integrations.** Paste your **Gemini API key** and press **Test**. (Skip this if you put `GEMINI_API_KEY` in `.env`; it is copied in on first start.)
4. **Add your Facebook Pages.** On the Dashboard, click **Import pages from Facebook**, then **Continue with Facebook**, allow access, then tick the Pages you want. (Or add a page by hand and connect it later under **Facebook connection**. Advanced users can paste a Page access token there instead.)
5. **Brand & schedule** (per page). Set the niche, brand name (write it in Bangla for fully Bangla banners), handle, logo, colours, banner style and the posting schedule. Switch the **Autopilot** toggle on.
6. **Autopilot.** Press **Create post to review** to see a post and banner without publishing. If you like it, press **Publish now**. (**Post to Facebook now** writes and publishes in one go.)

From then on it posts by itself on schedule. Day to day:

- **Post ideas:** collect or auto-research ideas, and send the good ones to the queue or planner.
- **Content queue:** topics waiting to be posted, highest priority first. When it is empty, Gemini invents a fresh topic from the page niche (and avoids the last 30 topics).
- **Content planner:** plan a whole month in one click. Posts are written the day before; turn on approval if you want to check each one first.
- **Post history:** every post with its banner. Retry failures, copy captions, open posts on Facebook.

---

## Create your Facebook App

You only do this once. It lets PixGen Pilot post to Pages you manage. **You do not need App Review** to post to your own Pages: in *Development* mode the app works for anyone with a role on it, and you are its admin.

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create App**. Name it anything (e.g. *PixGen Pilot*).
2. Use case: **Manage everything on your Page** (or app type **Business**).
3. Make sure these permissions are included (they come with that use case): `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`.
4. **Facebook Login → Settings → Valid OAuth Redirect URIs:** paste the URI shown in PixGen Pilot under **Platform settings**. It looks like `https://your-domain.com/api/facebook/oauth/callback`. Save.
5. **App settings → Basic:** add your domain under **App domains**, then copy the **App ID** and **App Secret** into PixGen Pilot (**Platform settings**).

Notes:

- Facebook only accepts **https://** redirect URLs. `http://localhost` works for local testing; on a server, set up HTTPS first ([below](#run-it-on-a-server-with-your-own-domain)) and set `PUBLIC_URL` to the `https://` address.
- Want someone else to connect their Pages to *your* installation? Add them under **App roles → Testers** in the Facebook App. Making the app public (*Live*) needs a privacy policy, Meta App Review and Business Verification; for personal use you don't need any of that.
- If you use *Facebook Login for Business*, also paste its **Login configuration ID** in Platform settings. Otherwise leave it empty.

---

## Run it on a server with your own domain

Any Linux VPS with 1 GB RAM or more works (2 GB is more comfortable, since Chromium renders the banners).

1. Point your domain's **A record** at the server's IP.
2. Install Docker ([docs.docker.com/engine/install](https://docs.docker.com/engine/install/)), then follow [Quick start](#quick-start-with-docker-recommended) on the server with `PUBLIC_URL=https://your-domain.com`.
3. Put HTTPS in front of it. The simplest option is [Caddy](https://caddyserver.com/docs/install), which gets and renews certificates automatically. `/etc/caddy/Caddyfile`:

   ```
   your-domain.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```

   Then `sudo systemctl reload caddy`.

   Using nginx instead? Proxy to `http://127.0.0.1:3000`, pass `Host` and `X-Forwarded-Proto`, and set `proxy_read_timeout 300s` (writing a post plus rendering the banner can take a minute or two). Get a certificate with `certbot --nginx`.

4. Once HTTPS works, stop exposing port 3000 to the internet: in `docker-compose.yml` change `"${HOST_PORT:-3000}:3000"` to `"127.0.0.1:${HOST_PORT:-3000}:3000"` and run `docker compose up -d`.

The image also runs on Coolify, Dokploy, Portainer and similar panels: deploy `docker-compose.yml` from this repository and enter the `.env` values as environment variables.

### Updating

```bash
git pull
docker compose up -d --build        # without Docker: npm install && npm run build, then restart
```

Database changes are applied automatically on start.

### Backups

Everything lives in MySQL, plus the generated banners. With Docker:

```bash
docker compose exec mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" fb_autopilot' > backup-$(date +%F).sql
```

Keep a copy of your `.env` too: without the same `SECRETS_KEY`, stored keys and tokens in a backup can't be decrypted.

---

## Settings reference (`.env`)

| Variable | Required | What it is |
| --- | --- | --- |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | yes | Your login, created on first start. Change the password later in **My account** |
| `SESSION_SECRET` | yes | Random string that signs login sessions (30 days) |
| `SECRETS_KEY` | yes | Random string that encrypts stored keys/tokens. **Set once, never change** |
| `PUBLIC_URL` | for Facebook login | Public address, e.g. `https://your-domain.com` |
| `PORT` | | Port the app listens on (default `3000`) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | yes | MySQL connection. With Docker Compose, `DB_HOST` is set for you |
| `MYSQL_ROOT_PASSWORD` | Docker only | Root password for the bundled MySQL container |
| `HOST_PORT` | | Docker Compose: port on the host (default `3000`) |
| `TIMEZONE` | | Timezone for all schedules (default `Asia/Dhaka`) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | | Copied into **Integrations** on first start; manage it there afterwards |
| `FB_APP_ID`, `FB_APP_SECRET`, `FB_LOGIN_CONFIG_ID` | | Alternative to entering the Facebook App in **Platform settings** |
| `PAGE_NICHE`, `BRAND_NAME`, `BRAND_HANDLE`, `BRAND_LOGO_URL`, `PRIMARY_COLOR`, `ACCENT_COLOR`, `CRON_SCHEDULE` | | Defaults for new pages (each page can change them in the dashboard) |
| `FB_GRAPH_VERSION` | | Facebook Graph API version (default `v21.0`) |
| `PUPPETEER_EXECUTABLE_PATH` | | Use a system Chromium instead of Puppeteer's download |

Keep hex colours in quotes (`PRIMARY_COLOR="#0f172a"`): without them `.env` treats `#` as a comment.

`CRON_SCHEDULE` uses cron format: `minute hour day month weekday`. Examples: `0 10 * * *` = every day at 10:00; `30 9,18 * * *` = 09:30 and 18:00; `0 20 * * 1-5` = weekdays at 20:00.

---

## Command line

```bash
npm run test-banner                                        # render a test banner, no database needed
node src/index.js --test-banner "আপনার শিরোনাম"            # test banner with your own headline
node src/index.js --preview ["topic"] --page <id>          # one preview for a page (id is in the URL: /pages/<id>)
node src/index.js --run-now --page <id>                    # full pipeline once, publishes
node src/index.js --reset-password <email> <new-password>  # forgot your password?
```

With Docker, prefix these with `docker compose exec app`, e.g. `docker compose exec app node src/index.js --reset-password you@example.com NewPass123`.

For development: `npm run dev` (API with auto-restart) and `npm run dev:web` (dashboard on http://localhost:5173 with hot reload).

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| **"Can't connect to MySQL"** on start | Check the `DB_*` values. With Docker, run `docker compose ps` and wait for `mysql` to be *healthy* |
| **Forgot the password** | `node src/index.js --reset-password you@example.com NewPassword` (with Docker, prefix `docker compose exec app`) |
| **Facebook: "URL blocked" / redirect URI error** | The redirect URI in the Facebook App must exactly match the one in **Platform settings**, and `PUBLIC_URL` must be your real `https://` address |
| **Facebook login works but no Pages are listed** | When Facebook asks, allow access to the Pages (and Business Portfolios) you want. You must be an admin of the Page |
| **Gemini errors (quota / 429 / billing)** | Add billing or credits to the Google project that owns the key, then press **Test** in Integrations |
| **Bangla text shows as boxes in banners** | Without Docker, install Bangla fonts (`fonts-noto-core fonts-beng`) and run `npm run test-banner` |
| **Banner rendering crashes on a small server** | Give the server or container at least 1 GB RAM; Docker Compose already sets `shm_size` for Chromium |
| **Posts aren't published on time** | Check the **Autopilot** toggle is on in **Brand & schedule**, the schedule and `TIMEZONE`, and `docker compose logs app` |
| **Log says "Could not decrypt a stored secret"** | `SECRETS_KEY` changed. Put the old value back, or re-enter the keys and reconnect the Pages |

---

## Project structure

```
brand/                      Logo mark
client/                     React dashboard (Vite + Tailwind) → built into client/dist
public/banners/             Generated PNG banners (served at /banners)
src/config/env.js           Environment loading and validation
src/db/                     MySQL pool, tables + automatic migrations, first-start setup, all SQL
src/services/               Gemini, banners, Facebook, scheduler + pipeline, planner, research, auth, encryption
src/templates/              1080×1080 banner templates (HTML)
src/web/                    Express app, auth, validation and API routes
src/index.js                Entry point and CLI
Dockerfile                  Production image (Node.js + Chromium + Bangla fonts)
docker-compose.yml          App + MySQL
```

## Security notes

- Never commit your `.env` (it's in `.gitignore`).
- Use a long `ADMIN_PASSWORD` and serve the dashboard over HTTPS on any public server.
- Repeated failed logins are locked out for 15 minutes; changing your password signs out every other session.

## License

[MIT](LICENSE). Free to use, change and share. Contributions and issues are welcome.

# Flappy - Minimal

A minimal vanilla JavaScript Flappy-style game you can run locally or publish to GitHub Pages.

Quick options
- **Run locally (recommended for testing):** clone, install deps, start the dev server and open the page.
- **Publish to friends (recommended):** use GitHub Pages to host the static site (no server required).

Local (play on your machine)

```bash
git clone git@github.com:YOUR_USER/YOUR_REPO.git
cd YOUR_REPO
npm install
npm start
# Open http://localhost:3000 in your browser
```

If you prefer a tiny static server (no Node server):

```bash
# from the project root
npx serve .
# or (python)
python3 -m http.server 8000
# then open http://localhost:8000
```

Publish with GitHub Pages (easy, free)

1. Create a new repository on GitHub and push your code (or push to an existing repo).

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin git@github.com:YOUR_USER/YOUR_REPO.git
git push -u origin main
```

2a. Simpler: use the `docs/` folder option

- Create a `docs/` folder and copy the website files into it, then push. GitHub Pages can serve `main` / `docs` automatically.

```bash
mkdir -p docs
cp index.html style.css README.md docs/
cp -R src assets docs/
git add docs
git commit -m "Add docs for GitHub Pages"
git push
```

Now open your repo on GitHub → Settings → Pages and select the `main` branch `/docs` folder and Save. The site URL will be listed there.

2b. Alternative: use `gh-pages` branch or deployers (Netlify, Vercel, Render) if you want CI/CD.

Notes for friends
- Controls: press Space or click/tap to flap. The page will attempt to enable background audio after a click or keypress (browser policy requires a gesture).
- If audio is silent, ensure the browser tab isn't muted and click the canvas once to allow playback.

Files of interest
- `index.html` — entry page
- `style.css` — visual styles
- `src/game.js` — main game logic
- `assets/` — images and audio

Contributing
- Add sprites to `assets/images/` and edit `src/game.js` to change sizes/positions.
- Add audio to `assets/audio/` and update filenames in `src/game.js` if needed.

Questions or want me to publish this for you? Tell me your GitHub repo name and whether you want it on GitHub Pages or a Node-hosted URL, and I can push and enable it.

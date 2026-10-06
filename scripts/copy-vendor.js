// Copies the Firebase web SDK (compat build) into www/vendor so the app works inside the WebView.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'www', 'vendor');
fs.mkdirSync(out, { recursive: true });
for (const f of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js']) {
  const src = path.join(root, 'node_modules', 'firebase', f);
  if (!fs.existsSync(src)) { console.error('Missing ' + src + ' — run npm install first'); process.exit(1); }
  fs.copyFileSync(src, path.join(out, f));
}
console.log('Firebase web SDK copied to www/vendor');

// Copies the Supabase JS client (UMD build) into www/vendor so the app works inside the WebView offline.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'www', 'vendor');
fs.mkdirSync(out, { recursive: true });

const candidates = [
  path.join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'),
  path.join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'supabase.js'),
  path.join(root, 'node_modules', '@supabase', 'supabase-js', 'umd', 'supabase.js')
];
let src = candidates.find(p => fs.existsSync(p));
if (!src) {
  console.error('Missing @supabase/supabase-js UMD build — run: npm install');
  process.exit(1);
}
fs.copyFileSync(src, path.join(out, 'supabase.js'));
console.log('Supabase JS client copied to www/vendor/supabase.js');

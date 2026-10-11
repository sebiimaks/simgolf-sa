// Small adjustments to the web page for the desktop app: wording that talks
// about "this browser", and the web page's play counter, which has no place
// in an offline app. Runs before the page's own scripts; touches only the DOM.

const WORDING = [
  ['The 2002 classic, running in your browser. You bring the game files; nothing is uploaded anywhere.',
    'The 2002 classic, in its own window. You bring the game files; they never leave your computer.'],
  ['Your game files are ready in this browser', 'Your game files are ready'],
  ['The page unpacks the game in about a minute and keeps it in this browser, so you only do this once.',
    'SimGolf unpacks the game in about a minute and keeps it, so you only do this once.'],
  ['Saves stay in this browser:', 'Saves stay on this computer:'],
  ["This page hosts none of the game's files.", "This app includes none of the game's files."],
  ['Saves are kept in this browser only (no save server).', 'Saves are kept on this computer (in the app).'],
];

function reword(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    let t = n.nodeValue;
    if (t.length < 12) continue;
    // Text can be split across nodes by markup (<strong>), so match on
    // whitespace-normalised text and only replace whole-node matches.
    const norm = t.replace(/\s+/g, ' ');
    for (const [from, to] of WORDING) {
      if (norm.includes(from)) t = norm.replace(from, to);
    }
    if (t !== n.nodeValue) n.nodeValue = t;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = '#count { display: none !important; }';
  document.head.appendChild(style);
  reword(document.body);
  // The saves panel (Ctrl+F8) is built later; reword it when it appears.
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) reword(n);
  }).observe(document.body, { childList: true, subtree: true });
});

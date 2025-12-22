
import React from 'react';
import ReactDOM from 'react-dom/client';

const rootElement = document.getElementById('root');
if (!rootElement) {
  document.body.innerHTML = '<pre style="color: red">Could not find root element to mount to</pre>';
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

// Dynamic import so we can catch module load errors and show a helpful message
import('./App').then(({ default: App }) => {
  console.log('App module loaded successfully');
  try {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log('App rendered');
  } catch (err) {
    console.error('Error during render', err);
    rootElement.innerHTML = `<pre style="color: red">Render error: ${String(err)}</pre>`;
  }
}).catch(err => {
  console.error('Error loading App module', err);
  rootElement.innerHTML = `<div style="padding:24px;font-family:monospace;color:#fff;background:#ba1a1a;border-radius:8px;">Error loading app: ${String(err)}</div>`;
});
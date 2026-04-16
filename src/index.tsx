import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

console.log('index.tsx: File loaded');
// document.body.innerHTML = '<h1>Vite is working</h1>';
window.addEventListener('load', () => console.log('index.tsx: Window loaded'));
document.addEventListener('DOMContentLoaded', () => console.log('index.tsx: DOMContentLoaded'));

const rootElement = document.getElementById('root');
console.log('index.tsx: Root element:', rootElement);
if (!rootElement) {
  console.error('Root element not found!');
} else {
  console.log('Root element found, rendering...');
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

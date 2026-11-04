import { createRoot } from 'react-dom/client';
import '@cocoasurface/ui/styles.css';
import './app.css';
import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(<App />);

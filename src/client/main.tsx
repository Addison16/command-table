import { createRoot } from 'react-dom/client';
import './styles/fonts.css';
import './styles/app.css';
import './styles/home.css';
import './styles/cards.css';
import { App } from './app/App.js';
createRoot(document.getElementById('root')!).render(<App />);

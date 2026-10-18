import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from './App';

describe('QA Board App Shell (Phase 0)', () => {
  it('renders the application header and default section in Portuguese', () => {
    render(<App />);
    expect(screen.getByText('QA Board')).toBeInTheDocument();
    expect(screen.getByText('100% Local • Segredos protegidos no cofre do SO')).toBeInTheDocument();
    expect(screen.getAllByText('Board de Bugs').length).toBeGreaterThan(0);
  });

  it('switches navigation sections when clicking sidebar items', () => {
    render(<App />);
    const settingsButton = screen.getByRole('button', {
      name: /Configurações & Integrações/i,
    });
    fireEvent.click(settingsButton);
    expect(screen.getByText(/Integração segura via Rust \+ cofre do sistema/i)).toBeInTheDocument();
  });
});

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import App from './App';
import { resetInMemoryStoreForTests } from './db/database';

describe('QA Board App Shell & Phase 1 Integration', () => {
  beforeEach(() => {
    resetInMemoryStoreForTests();
  });

  it('renders the application header and default Kanban columns in Portuguese', async () => {
    render(<App />);
    expect(screen.getByText('QA Board')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Novo' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Em análise' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Reportado' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Aguardando fix' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Reteste' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Fechado' })).toBeInTheDocument();
    });
  });

  it('toggles between dark and light mode', async () => {
    render(<App />);
    const toggleBtn = await screen.findByRole('button', { name: /Ativar modo claro/i });
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Ativar modo escuro/i })).toBeInTheDocument();
    });
  });

  it('creates, filters, moves, and deletes a bug card through the UI', async () => {
    render(<App />);

    const newBugBtn = await screen.findByRole('button', { name: /^Novo Bug$/i });
    fireEvent.click(newBugBtn);

    const titleInput = await screen.findByLabelText(/Título do Bug/i);
    fireEvent.change(titleInput, {
      target: { value: 'Erro ao calcular frete no Checkout' },
    });

    const severitySelect = screen.getByLabelText(/^Severidade$/i);
    fireEvent.change(severitySelect, { target: { value: 'Crítica' } });

    const moduleInput = screen.getByLabelText(/Módulo \/ Feature/i);
    fireEvent.change(moduleInput, { target: { value: 'Checkout' } });

    const buildInput = screen.getByLabelText(/Versão \/ Build/i);
    fireEvent.change(buildInput, { target: { value: 'v2.5.0' } });

    const tagsInput = screen.getByLabelText(/Tags/i);
    fireEvent.change(tagsInput, { target: { value: 'frete, regressão' } });

    const submitBtn = screen.getByRole('button', { name: /^Criar Bug$/i });
    fireEvent.click(submitBtn);

    // Verify bug appears on the board
    await waitFor(() => {
      expect(screen.getByText('Erro ao calcular frete no Checkout')).toBeInTheDocument();
    });

    // Test search filter
    const searchInput = screen.getByLabelText('Buscar por texto');
    fireEvent.change(searchInput, { target: { value: 'inexistente' } });
    expect(screen.queryByText('Erro ao calcular frete no Checkout')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: 'frete' } });
    expect(screen.getByText('Erro ao calcular frete no Checkout')).toBeInTheDocument();

    // Move bug to next column
    const moveRightBtn = screen.getByRole('button', {
      name: /Mover Erro ao calcular frete no Checkout para próxima coluna/i,
    });
    fireEvent.click(moveRightBtn);

    await waitFor(() => {
      const moveLeftBtn = screen.getByRole('button', {
        name: /Mover Erro ao calcular frete no Checkout para coluna anterior/i,
      });
      expect(moveLeftBtn).not.toBeDisabled();
    });

    // Delete bug
    const deleteBtn = screen.getByRole('button', {
      name: /Excluir Erro ao calcular frete no Checkout/i,
    });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.queryByText('Erro ao calcular frete no Checkout')).not.toBeInTheDocument();
    });
  });
});

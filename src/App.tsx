import { useCallback, useEffect, useState } from 'react';
import {
  Bug,
  ClipboardCheck,
  PlayCircle,
  BarChart3,
  Settings,
  ShieldCheck,
  Layers,
  Sun,
  Moon,
  Zap,
} from 'lucide-react';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ThemeMode } from './types/models';
import {
  getQuickCaptureShortcut,
  getThemePreference,
  isTauriRuntime,
  setThemePreference,
} from './db/database';
import { BugsBoardView } from './features/bugs';
import { TestCasesView } from './features/testcases';
import { TestRunsView } from './features/runs';
import { QuickCaptureModal, ReportsView } from './features/reports';
import { SettingsView } from './features/settings';

type ActiveSection = 'bugs' | 'testcases' | 'runs' | 'reports' | 'settings';

interface NavItem {
  id: ActiveSection;
  label: string;
  phase: string;
  description: string;
  icon: typeof Bug;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'bugs',
    label: 'Board de Bugs',
    phase: 'Ativo',
    description:
      'Kanban com colunas editáveis, severidade, anexos com Ctrl+V, filtros e backup completo.',
    icon: Bug,
  },
  {
    id: 'testcases',
    label: 'Casos de Teste',
    phase: 'Ativo',
    description:
      'Biblioteca de casos de teste, pré-condições, passos e checklists reutilizáveis (smoke/regressão).',
    icon: ClipboardCheck,
  },
  {
    id: 'runs',
    label: 'Execuções (Test Runs)',
    phase: 'Ativo',
    description:
      'Execução por build/ambiente, criação rápida de bug a partir de falha e sessões exploratórias com timer.',
    icon: PlayCircle,
  },
  {
    id: 'reports',
    label: 'Produtividade & Relatórios',
    phase: 'Ativo',
    description:
      'Templates para Jira/Azure DevOps/Markdown, captura rápida global, dashboard, exportação PDF/MD e massa de dados.',
    icon: BarChart3,
  },
  {
    id: 'settings',
    label: 'Configurações & Integrações',
    phase: 'Ativo',
    description:
      'Integração segura via Rust + cofre do sistema (keyring) com Jira, Azure DevOps e Slack.',
    icon: Settings,
  },
];

export default function App() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('bugs');
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [isQuickCaptureOpen, setIsQuickCaptureOpen] = useState(false);
  const [quickShortcut, setQuickShortcut] = useState('CommandOrControl+Shift+B');
  const [boardRefreshCounter, setBoardRefreshCounter] = useState(0);
  const [settingsNotice, setSettingsNotice] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);

  const handleSettingsNotify = useCallback(
    (text: string, type: 'success' | 'error' = 'success') => {
      setSettingsNotice({ text, type });
      setTimeout(() => {
        setSettingsNotice((prev) => (prev?.text === text ? null : prev));
      }, 4500);
    },
    [],
  );

  const registerGlobalHotkey = useCallback(async (shortcutStr: string) => {
    if (!isTauriRuntime()) return;
    try {
      await unregisterAll();
      await register(shortcutStr, async (event) => {
        if (event.state === 'Pressed') {
          try {
            const win = getCurrentWindow();
            await win.unminimize();
            await win.show();
            await win.setFocus();
          } catch {
            // ignore window focus errors
          }
          setIsQuickCaptureOpen(true);
        }
      });
    } catch {
      // Ignore if shortcut is already registered by another OS app
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const [savedTheme, savedShortcut] = await Promise.all([
        getThemePreference(),
        getQuickCaptureShortcut(),
      ]);
      setTheme(savedTheme);
      setQuickShortcut(savedShortcut);
      await registerGlobalHotkey(savedShortcut);
    })();
  }, [registerGlobalHotkey]);

  // In-window keyboard shortcut listener fallback (Ctrl+Shift+B)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsQuickCaptureOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleToggleTheme = async () => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    await setThemePreference(next);
  };

  const handleShortcutUpdated = async (newShortcut: string) => {
    setQuickShortcut(newShortcut);
    await registerGlobalHotkey(newShortcut);
  };

  const isLight = theme === 'light';

  return (
    <div
      className={`min-h-screen flex flex-col transition-colors ${
        isLight ? 'bg-slate-50 text-slate-900' : 'bg-slate-950 text-slate-100'
      }`}
    >
      {/* Header */}
      <header
        className={`border-b px-6 py-3.5 flex items-center justify-between ${
          isLight
            ? 'border-slate-200 bg-white/90'
            : 'border-slate-800 bg-slate-900/80 backdrop-blur'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
            <Bug className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">QA Board</h1>
            <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              Board pessoal de QA • Bugs, Casos de Teste e Execuções
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div
            className={`hidden md:flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border ${
              isLight
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                : 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60'
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            <span>100% Local • Segredos protegidos no cofre do SO</span>
          </div>

          <button
            type="button"
            onClick={() => setIsQuickCaptureOpen(true)}
            title={`Captura Rápida de Bug (${quickShortcut})`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
          >
            <Zap className="h-3.5 w-3.5" />
            <span>Captura Rápida</span>
          </button>

          <button
            type="button"
            onClick={() => void handleToggleTheme()}
            aria-label={isLight ? 'Ativar modo escuro' : 'Ativar modo claro'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              isLight
                ? 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
          >
            {isLight ? (
              <>
                <Moon className="h-3.5 w-3.5 text-indigo-600" />
                <span>Modo Escuro</span>
              </>
            ) : (
              <>
                <Sun className="h-3.5 w-3.5 text-amber-400" />
                <span>Modo Claro</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Navigation */}
        <aside
          className={`w-64 border-r p-4 flex flex-col justify-between shrink-0 ${
            isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900/40'
          }`}
        >
          <nav className="space-y-1.5" aria-label="Menu principal">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === activeSection;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : isLight
                        ? 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                        : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                      isActive
                        ? 'bg-indigo-500 text-white'
                        : isLight
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {item.phase}
                  </span>
                </button>
              );
            })}
          </nav>

          <div
            className={`rounded-lg border p-3 text-xs space-y-1 ${
              isLight
                ? 'border-slate-200 bg-slate-50 text-slate-600'
                : 'border-slate-800 bg-slate-900/70 text-slate-400'
            }`}
          >
            <div className="font-semibold flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-indigo-500" />
              <span>Status do Projeto</span>
            </div>
            <p>
              Fase 4 ativa: Integrações seguras via Rust + Cofre do SO com Jira, Azure DevOps e
              Slack.
            </p>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-6 overflow-y-auto">
          {activeSection === 'bugs' ? (
            <BugsBoardView key={boardRefreshCounter} theme={theme} onThemeRestored={setTheme} />
          ) : activeSection === 'testcases' ? (
            <TestCasesView theme={theme} />
          ) : activeSection === 'runs' ? (
            <TestRunsView theme={theme} onNavigateToBugs={() => setActiveSection('bugs')} />
          ) : activeSection === 'reports' ? (
            <ReportsView theme={theme} />
          ) : (
            <div className="space-y-4">
              {settingsNotice && (
                <div
                  role="status"
                  className={`px-4 py-2.5 rounded-xl border text-xs font-medium ${
                    settingsNotice.type === 'success'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                      : 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                  }`}
                >
                  {settingsNotice.text}
                </div>
              )}
              <SettingsView onNotify={handleSettingsNotify} />
            </div>
          )}
        </main>
      </div>

      {/* Global Quick Capture Modal */}
      <QuickCaptureModal
        isOpen={isQuickCaptureOpen}
        theme={theme}
        currentShortcut={quickShortcut}
        onShortcutUpdated={handleShortcutUpdated}
        onBugCreated={() => setBoardRefreshCounter((c) => c + 1)}
        onClose={() => setIsQuickCaptureOpen(false)}
      />
    </div>
  );
}

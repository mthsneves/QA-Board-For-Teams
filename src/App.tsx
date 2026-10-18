import { useEffect, useState } from 'react';
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
} from 'lucide-react';
import { ThemeMode } from './types/models';
import { getThemePreference, setThemePreference } from './db/database';
import { BugsBoardView } from './features/bugs';

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
    phase: 'Fase 2',
    description:
      'Biblioteca de casos de teste, pré-condições, passos e checklists reutilizáveis (smoke/regressão).',
    icon: ClipboardCheck,
  },
  {
    id: 'runs',
    label: 'Execuções (Test Runs)',
    phase: 'Fase 2',
    description:
      'Execução por build/ambiente, criação rápida de bug a partir de falha e sessões exploratórias com timer.',
    icon: PlayCircle,
  },
  {
    id: 'reports',
    label: 'Produtividade & Relatórios',
    phase: 'Fase 3',
    description:
      'Templates para Jira/Azure DevOps/Markdown, captura rápida global, dashboard, exportação PDF/MD e massa de dados.',
    icon: BarChart3,
  },
  {
    id: 'settings',
    label: 'Configurações & Integrações',
    phase: 'Fase 4',
    description:
      'Integração segura via Rust + cofre do sistema (keyring) com Jira, Azure DevOps e Slack.',
    icon: Settings,
  },
];

export default function App() {
  const [activeSection, setActiveSection] = useState<ActiveSection>('bugs');
  const [theme, setTheme] = useState<ThemeMode>('dark');

  useEffect(() => {
    void (async () => {
      const savedTheme = await getThemePreference();
      setTheme(savedTheme);
    })();
  }, []);

  const handleToggleTheme = async () => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    await setThemePreference(next);
  };

  const isLight = theme === 'light';
  const currentItem = NAV_ITEMS.find((item) => item.id === activeSection) ?? NAV_ITEMS[0];
  const CurrentIcon = currentItem.icon;

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

        <div className="flex items-center gap-3">
          <div
            className={`hidden sm:flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border ${
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
            <p>Fase 1 (MVP) ativa: Kanban de bugs, anexos Ctrl+V, filtros, backup e temas.</p>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-6 overflow-y-auto">
          {activeSection === 'bugs' ? (
            <BugsBoardView theme={theme} onThemeRestored={setTheme} />
          ) : (
            <div className="max-w-3xl mx-auto">
              <div
                className={`rounded-2xl border p-6 shadow-sm ${
                  isLight ? 'border-slate-200 bg-white' : 'border-slate-800 bg-slate-900/60'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                    <CurrentIcon className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold">{currentItem.label}</h2>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                        {currentItem.phase}
                      </span>
                    </div>
                    <p className={`text-sm ${isLight ? 'text-slate-600' : 'text-slate-300'}`}>
                      {currentItem.description}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

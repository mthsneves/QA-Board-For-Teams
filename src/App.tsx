import { useState } from 'react';
import {
  Bug,
  ClipboardCheck,
  PlayCircle,
  BarChart3,
  Settings,
  ShieldCheck,
  Database,
  Layers,
} from 'lucide-react';

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
    phase: 'Fase 1',
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
  const currentItem = NAV_ITEMS.find((item) => item.id === activeSection) ?? NAV_ITEMS[0];
  const CurrentIcon = currentItem.icon;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/30">
            <Bug className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">QA Board</h1>
            <p className="text-xs text-slate-400">
              Board pessoal de QA • Bugs, Casos de Teste e Execuções
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-3 py-1.5 rounded-full">
          <ShieldCheck className="h-4 w-4" />
          <span>100% Local • Segredos protegidos no cofre do SO</span>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Navigation */}
        <aside className="w-64 border-r border-slate-800 bg-slate-900/40 p-4 flex flex-col justify-between">
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
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      isActive ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {item.phase}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-400 space-y-1">
            <div className="font-semibold text-slate-200 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-indigo-400" />
              <span>Status do Projeto</span>
            </div>
            <p>Fase 0 concluída: ambiente Tauri 2 + React + TypeScript + Tailwind pronto.</p>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                  <CurrentIcon className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold text-white">{currentItem.label}</h2>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      {currentItem.phase}
                    </span>
                  </div>
                  <p className="text-sm text-slate-300">{currentItem.description}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-2">
                <div className="flex items-center gap-2 text-indigo-400 font-medium text-sm">
                  <Database className="h-4 w-4" />
                  <span>Persistência Local</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Banco SQLite local via <code className="text-slate-300">tauri-plugin-sql</code>{' '}
                  com migrations versionadas e anexos salvos na pasta de dados do app.
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-2">
                <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Segurança & Keyring</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Tokens do Jira, Azure DevOps e Slack ficam exclusivamente no cofre do sistema
                  operacional e só o backend Rust os acessa.
                </p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-2">
                <div className="flex items-center gap-2 text-amber-400 font-medium text-sm">
                  <Layers className="h-4 w-4" />
                  <span>Arquitetura Modular</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Código organizado por domínio em{' '}
                  <code className="text-slate-300">src/features</code> e integrações isoladas em{' '}
                  <code className="text-slate-300">src-tauri/src/integrations</code>.
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

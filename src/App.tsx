import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { StudySettingsProvider } from './contexts/StudySettingsContext';
import { PomodoroProvider } from './contexts/PomodoroContext';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { Exams } from './pages/Exams';
import { ExamNew } from './pages/ExamNew';
import { ExamDetail } from './pages/ExamDetail';
import { ExamEdit } from './pages/ExamEdit';
import { Collections } from './pages/Collections';
import { CollectionNew } from './pages/CollectionNew';
import { CollectionDetail } from './pages/CollectionDetail';
import { StudyMode } from './pages/StudyMode';
import { GlobalReview } from './pages/GlobalReview';
import { DisciplineStudy } from './pages/DisciplineStudy';
import { FavoritesReview } from './pages/FavoritesReview';
import { Settings } from './pages/Settings';
import { Stats } from './pages/Stats';
import { Profile } from './pages/Profile';
import { Pomodoro } from './pages/Pomodoro';
import { PomodoroStats } from './pages/PomodoroStats';
import { MindMapHub } from './pages/MindMapHub';
import { MindMapNew } from './pages/MindMapNew';
import { MindMapList } from './pages/MindMapList';
import { MindMapView } from './pages/MindMapView';
import { SummaryHub } from './pages/SummaryHub';
import { SummaryNew } from './pages/SummaryNew';
import { SummaryList } from './pages/SummaryList';
import { BulletPointsHub } from './pages/BulletPointsHub';
import { BulletPointsNew } from './pages/BulletPointsNew';
import { BulletPointsList } from './pages/BulletPointsList';
import { GlobalSearch } from './pages/GlobalSearch';
import { AnkiImport } from './pages/AnkiImport';
import { MockExams } from './pages/MockExams';
import { MockExamDetail } from './pages/MockExamDetail';
import { MockExamTake } from './pages/MockExamTake';

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <StudySettingsProvider>
            <BrowserRouter>
              <AuthProvider>
                <PomodoroProvider>
                  <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/registrar" element={<Register />} />

                    <Route element={<Layout />}>
                      <Route path="/painel" element={<Dashboard />} />
                      <Route path="/concursos" element={<Exams />} />
                      <Route path="/concursos/novo" element={<ExamNew />} />
                      <Route path="/concursos/:id" element={<ExamDetail />} />
                      <Route path="/concursos/:id/editar" element={<ExamEdit />} />
                      <Route path="/simulados" element={<MockExams />} />
                      <Route path="/simulados/:id" element={<MockExamDetail />} />
                      <Route path="/simulados/:id/fazer" element={<MockExamTake />} />
                      <Route path="/colecoes" element={<Collections />} />
                      <Route path="/colecoes/nova" element={<CollectionNew />} />
                      <Route path="/colecoes/:id" element={<CollectionDetail />} />
                      <Route path="/colecoes/:id/estudar" element={<StudyMode />} />
                      <Route path="/revisar" element={<GlobalReview />} />
                      <Route path="/disciplina/estudar" element={<DisciplineStudy />} />
                      <Route path="/favoritos" element={<FavoritesReview />} />
                      <Route path="/buscar" element={<GlobalSearch />} />
                      <Route path="/importar-anki" element={<AnkiImport />} />
                      <Route path="/configuracoes" element={<Settings />} />
                      <Route path="/estatisticas" element={<Stats />} />
                      <Route path="/perfil" element={<Profile />} />
                      <Route path="/pomodoro" element={<Pomodoro />} />
                      <Route path="/pomodoro/estatisticas" element={<PomodoroStats />} />
                      <Route path="/mapas-mentais" element={<MindMapHub />} />
                      <Route path="/mapas-mentais/criar" element={<MindMapNew />} />
                      <Route path="/mapas-mentais/meus" element={<MindMapList />} />
                      <Route path="/mapas-mentais/:id" element={<MindMapView />} />
                      <Route path="/resumos" element={<SummaryHub />} />
                      <Route path="/resumos/criar" element={<SummaryNew />} />
                      <Route path="/resumos/meus" element={<SummaryList />} />
                      <Route path="/bullet-points" element={<BulletPointsHub />} />
                      <Route path="/bullet-points/criar" element={<BulletPointsNew />} />
                      <Route path="/bullet-points/meus" element={<BulletPointsList />} />
                    </Route>

                    <Route path="/" element={<Navigate to="/painel" replace />} />
                    <Route path="*" element={<Navigate to="/painel" replace />} />
                  </Routes>
                </PomodoroProvider>
              </AuthProvider>
            </BrowserRouter>
          </StudySettingsProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

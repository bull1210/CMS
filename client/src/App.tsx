import { Navigate, Route, Routes } from 'react-router-dom';
import { getToken, getUser } from './api';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Patients from './pages/Patients';
import PatientDetail from './pages/PatientDetail';
import Appointments from './pages/Appointments';
import ProceduresPage from './pages/ProceduresPage';
import Billing from './pages/Billing';
import Inventory from './pages/Inventory';
import Expenses from './pages/Expenses';
import Settings from './pages/Settings';
import PrintInvoice from './pages/PrintInvoice';
import PrintPrescription from './pages/PrintPrescription';
import PrintEstimate from './pages/PrintEstimate';
import PrintConsent from './pages/PrintConsent';

function RequireAuth({ children }: { children: JSX.Element }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

/** Admins work only in Settings — send them there instead of the clinical home. */
function Home() {
  return getUser()?.role === 'ADMIN' ? <Navigate to="/settings" replace /> : <Dashboard />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/print/invoice/:id" element={<RequireAuth><PrintInvoice /></RequireAuth>} />
      <Route path="/print/prescription/:id" element={<RequireAuth><PrintPrescription /></RequireAuth>} />
      <Route path="/print/estimate/:id" element={<RequireAuth><PrintEstimate /></RequireAuth>} />
      <Route path="/print/consent/:patientId/:type" element={<RequireAuth><PrintConsent /></RequireAuth>} />
      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Home />} />
        <Route path="patients" element={<Patients />} />
        <Route path="patients/:id" element={<PatientDetail />} />
        <Route path="appointments" element={<Appointments />} />
        <Route path="procedures" element={<ProceduresPage />} />
        <Route path="billing" element={<Billing />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

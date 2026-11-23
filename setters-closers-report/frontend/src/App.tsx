import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import ExportReports from "./pages/ExportReports";
import History from "./pages/History";
import { BookingReport, RolePerformance } from "./pages/ReportPages";
import SettingsPage from "./pages/SettingsPage";
import UploadReports from "./pages/UploadReports";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="upload" element={<UploadReports />} />
        <Route path="setters" element={<RolePerformance role="setters" key="s" />} />
        <Route path="closers" element={<RolePerformance role="closers" key="c" />} />
        <Route path="bookings" element={<BookingReport />} />
        <Route path="history" element={<History />} />
        <Route path="export" element={<ExportReports />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

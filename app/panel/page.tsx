import { PanelWelcome } from "@/components/panel/PanelWelcome";

function EmptyData() {
  return <div className="dashboard-empty" aria-label="Sin datos cargados" />;
}

const metrics = ["Clientes activos", "Expedientes en trámite", "Audiencias esta semana", "Vencimientos próximos", "Consultas web", "Honorarios pendientes"];

export default function PanelPage() {
  return <main className="panel-main"><div className="breadcrumbs">Inicio / <b>Gestión integral del estudio</b></div><section className="panel-welcome"><PanelWelcome /></section><div className="metric-grid">{metrics.map((label) => <article className="metric-card" key={label}><span>{label}</span><EmptyData /></article>)}</div><div className="dashboard-grid"><article className="data-card large"><div className="card-heading"><div><span className="eyebrow dark">DISTRIBUCIÓN DE LITIGIOS</span><h2>Volumen activo por materia jurídica</h2></div></div><div className="dashboard-scroll"><EmptyData /></div></article><article className="data-card"><div className="card-heading"><div><span className="eyebrow dark">AGENDA FORENSE</span><h2>Próximas actividades</h2></div></div><div className="dashboard-scroll"><EmptyData /></div></article><article className="data-card large"><div className="card-heading"><div><span className="eyebrow dark">PRIORIDAD INMEDIATA</span><h2>Vencimientos procesales</h2></div></div><div className="dashboard-scroll"><EmptyData /></div></article><article className="data-card"><div className="card-heading"><div><span className="eyebrow dark">ACTIVIDAD RECIENTE</span><h2>Actividad reciente</h2></div></div><div className="dashboard-scroll"><EmptyData /></div></article></div></main>;
}

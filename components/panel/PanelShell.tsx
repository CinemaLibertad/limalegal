"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { getClientAuth } from "../../lib/firebase/client";

const menu = [
  ["GENERAL", [["▦", "Dashboard", "/panel"], ["□", "Agenda y calendario", "/panel/agenda"], ["◷", "Tareas y vencimientos", "/panel/tareas"], ["♧", "Notificaciones", "/panel/notificaciones"]]],
  ["GESTIÓN JURÍDICA", [["♙", "Clientes", "/panel/clientes"], ["▣", "Expedientes", "/panel/expedientes"], ["◷", "Actividad de tribunales", "/panel/actividad-tribunales"], ["⚖", "Juicios y actuaciones", "/panel/juicios-actuaciones"], ["▤", "Organismos judiciales", "/panel/organismos"], ["▥", "Fallos y jurisprudencia", "/panel/jurisprudencia"]]],
  ["DOCUMENTACIÓN", [["▧", "Biblioteca documental", "#"], ["⌑", "Escáner y digitalización", "#"], ["◌", "Archivos pendientes", "#"]]],
  ["ADMINISTRACIÓN", [["$", "Finanzas", "#"], ["✉", "Consultas recibidas", "#"], ["⌁", "Informes y estadísticas", "#"]]],
  ["PREFERENCIAS", [["⚙", "Configuración", "/panel/configuracion"]]],
];

export function PanelShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className="panel-shell"><aside className="panel-sidebar"><Link href="/panel" className="sidebar-brand" aria-label="Lima Legal, inicio"><Image src="/images/brand/lima-legal-title.png" alt="Lima Legal — Gestión e investigación jurídica" width={220} height={52} priority /></Link><nav>{menu.map(([group, items]) => <div className="nav-group" key={String(group)}><span className="nav-label">{String(group)}</span>{(items as string[][]).map(([icon, label, href]) => <Link className={pathname === href || (href !== "/panel" && pathname.startsWith(`${href}/`)) ? "active" : ""} href={href} key={label}><i>{icon}</i>{label}</Link>)}</div>)}</nav><div className="sidebar-secure">◈ <span>Área privada</span></div></aside><section className="panel-content"><header className="panel-header"><div className="panel-search">⌕ <input placeholder="Buscar causas, clientes, expedientes…" /></div><Link href="/" className="public-link">◉ Sitio público</Link><Link href="/panel/notificaciones" className="icon-button" aria-label="Notificaciones">♧</Link><div className="user-chip"><span>Lima Legal</span><small>Espacio de trabajo</small><button onClick={() => void signOut(getClientAuth())} aria-label="Cerrar sesión">↪</button></div></header>{children}</section></div>;
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import { getClientAuth } from "../../lib/firebase/client";
import { STUDIO_ID } from "../../lib/activities/activity.model";
import { listCases } from "../../lib/firebase/domain-repositories";
import type { LegalAnnotation, LegalCitationSnapshot, LegalDraft, LegalDraftInput, LegalDraftVersion, JurisprudenceResult, JurisprudenceSearchResponse } from "../../lib/jurisprudence/jurisprudence.model";
import { getJurisprudenceDetails, searchJurisprudence } from "../../lib/jurisprudence/jurisprudence.client";
import { listLegalAnnotations, listLegalCitations, listLegalDrafts, listLegalDraftVersions, markLegalCitationVerified, registerLegalDraftVersion, saveLegalAnnotation, saveLegalCitation, saveLegalDraft } from "../../lib/jurisprudence/jurisprudence.repository";
import { LegalCitationNode } from "./LegalCitationNode";
import { createGoogleDriveUploadSession, getGoogleDriveStatus } from "../../lib/integrations/google-drive.client";
import { getOneDriveStatus, uploadOneDriveFile } from "../../lib/integrations/onedrive.client";

type WorkspaceTab = "research" | "library" | "drafts";
type PaneSize = { research: number; editor: number };
const emptyContent = { type: "doc", content: [{ type: "paragraph" }] };
const sourceLinks = [
  { label: "SAIJ · sitio oficial", url: "https://www.saij.gob.ar/" },
  { label: "CSJN · sitio oficial", url: "https://sjservicios.csjn.gov.ar/sj/" },
  { label: "JUBA · Suprema Corte bonaerense", url: "https://juba.scba.gov.ar/Default.aspx?CodTrib=scba" },
];
const citationSourceLink = (value: string | null) => getOfficialUrl(value);

function getOfficialUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const allowed = ["saij.gob.ar", "csjn.gov.ar", "scba.gov.ar"];
    return url.protocol === "https:" && allowed.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.toString() : null;
  } catch { return null; }
}

function formatDate(value: string | null) {
  if (!value) return "Fecha no informada";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-AR", { dateStyle: "long" }).format(date);
}

function getSelectionText() { return window.getSelection()?.toString().trim() ?? ""; }

export function JurisprudenceWorkspace() {
  const [tab, setTab] = useState<WorkspaceTab>("research");
  const [queryText, setQueryText] = useState("");
  const [response, setResponse] = useState<JurisprudenceSearchResponse | null>(null);
  const [results, setResults] = useState<JurisprudenceResult[]>([]);
  const [selected, setSelected] = useState<JurisprudenceResult | null>(null);
  const [citations, setCitations] = useState<LegalCitationSnapshot[]>([]);
  const [annotations, setAnnotations] = useState<LegalAnnotation[]>([]);
  const [drafts, setDrafts] = useState<LegalDraft[]>([]);
  const [versions, setVersions] = useState<LegalDraftVersion[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [activeDraft, setActiveDraft] = useState<LegalDraft | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [caseId, setCaseId] = useState("");
  const [cases, setCases] = useState<Array<{ id: string; caption: string; number: string }>>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [savedFileAt, setSavedFileAt] = useState("");
  const [conflict, setConflict] = useState(false);
  const [storageChoices, setStorageChoices] = useState<Array<"google-drive" | "onedrive">>([]);
  const [storageDialog, setStorageDialog] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [sizes, setSizes] = useState<PaneSize>({ research: 1, editor: 1.2 });
  const [maximized, setMaximized] = useState<"research" | "editor" | null>(null);
  const dragStart = useRef<{ x: number; research: number; editor: number } | null>(null);
  const activeDraftRef = useRef(activeDraft); activeDraftRef.current = activeDraft;
  const draftTitleRef = useRef(draftTitle); draftTitleRef.current = draftTitle;
  const caseIdRef = useRef(caseId); caseIdRef.current = caseId;

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), Highlight.configure({ multicolor: false }), LegalCitationNode],
    content: emptyContent,
    immediatelyRender: false,
    editorProps: { attributes: { class: "legal-editor-content", "aria-label": "Editor de escrito jurídico" } },
    onUpdate: ({ editor: current }) => {
      setActiveDraft((previous) => previous ? { ...previous, content: current.getJSON() } : null);
      setDirty(true);
      setError("");
    },
  });

  const selectedAnnotations = useMemo(() => selected?.providerId ? annotations.filter((item) => item.providerDocumentId === selected.providerId && item.source === selected.source) : [], [annotations, selected]);
  const currentCaseLabel = cases.find((item) => item.id === caseId);

  const loadPrivateData = useCallback(async () => {
    try {
      const [draftRows, citationRows, annotationRows, caseRows] = await Promise.all([listLegalDrafts(), listLegalCitations(), listLegalAnnotations(), listCases()]);
      setDrafts(draftRows); setCitations(citationRows); setAnnotations(annotationRows);
      setCases(caseRows.map((item) => ({ id: item.id, caption: item.caption, number: item.number })));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo cargar la biblioteca privada del estudio."); }
  }, []);

  useEffect(() => { void loadPrivateData(); }, [loadPrivateData]);

  useEffect(() => {
    if (!dirty || !editor) return;
    const timer = window.setTimeout(async () => {
      const user = getClientAuth().currentUser;
      if (!user) { setError("La sesión no está disponible para guardar el borrador."); return; }
      setSaving(true); setError("");
      const current = activeDraftRef.current;
      const input: LegalDraftInput = { title: draftTitleRef.current.trim() || "Escrito sin título", content: editor.getJSON(), caseId: (caseIdRef.current || null) as LegalDraftInput["caseId"] };
      try {
        const saved = await saveLegalDraft(input, user, current?.id ?? null, current?.revision ?? 0);
        const updated = { ...(current ?? { studioId: STUDIO_ID, createdAt: "", createdBy: user.email ?? user.uid }), ...input, id: saved.id, revision: saved.revision, updatedAt: new Date().toISOString(), updatedBy: user.email ?? user.uid } as LegalDraft;
        activeDraftRef.current = updated; setActiveDraft(updated); setDirty(false); setSavedAt(new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }));
        setDrafts((previous) => [updated, ...previous.filter((item) => item.id !== updated.id)].slice(0, 50));
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "No se pudo guardar el borrador.";
        setConflict(message.startsWith("conflict:")); setError(message.replace(/^conflict:\s*/, ""));
      }
      finally { setSaving(false); }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [dirty, editor, draftTitle, caseId]);

  async function runSearch(event?: FormEvent) {
    event?.preventDefault();
    if (queryText.trim().length < 2) { setError("Ingresá al menos dos caracteres para buscar."); return; }
    setLoading(true); setError(""); setTab("research"); setSelected(null);
    try {
      const data = await searchJurisprudence(queryText.trim());
      setResponse(data); setResults(data.results);
    } catch (reason) {
      const code = (reason as { code?: string })?.code;
      const message = reason instanceof Error ? reason.message : "No se pudo completar la búsqueda.";
      setError(code?.includes("failed-precondition") ? "La integración todavía necesita la clave privada de Jurídica en Secret Manager." : message);
      setResults([]); setResponse(null);
    } finally { setLoading(false); }
  }

  async function loadMore() {
    if (!response || loading) return;
    setLoading(true); setError("");
    try {
      const next = await searchJurisprudence(queryText.trim(), response.offset + response.count);
      setResponse(next); setResults((previous) => [...previous, ...next.results]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo cargar la página siguiente."); }
    finally { setLoading(false); }
  }

  async function openResult(result: JurisprudenceResult) {
    setSelected(result); setError("");
    if (!result.providerId) return;
    setLoading(true);
    try {
      const details = await getJurisprudenceDetails(result.providerId);
      setSelected((current) => {
        if (current?.providerId !== result.providerId) return current;
        return {
          ...current,
          source: details.source ?? current.source,
          type: details.type ?? current.type,
          title: details.title ?? current.title,
          caption: details.caption ?? current.caption,
          court: details.court ?? current.court,
          decisionDate: details.decisionDate ?? current.decisionDate,
          jurisdiction: details.jurisdiction ?? current.jurisdiction,
          text: details.text ?? current.text,
          officialUrl: details.officialUrl ?? current.officialUrl,
          providerId: result.providerId,
        };
      });
    } catch (reason) {
      setError(reason instanceof Error ? `${reason.message} Podés abrir la fuente oficial si el resultado incluyó un enlace.` : "No se pudo recuperar el detalle del documento.");
    } finally { setLoading(false); }
  }

  function openDraft(draft: LegalDraft) {
    if (dirty) { setError("Esperá a que termine el autoguardado antes de cambiar de escrito."); return; }
    activeDraftRef.current = draft; setActiveDraft(draft); setDraftTitle(draft.title); setCaseId(draft.caseId ?? ""); setDirty(false); setTab("drafts"); setError(""); setVersions([]); setVersionsOpen(false);
    editor?.commands.setContent(draft.content, { emitUpdate: false });
  }

  function newDraft() {
    if (dirty) { setError("Esperá a que termine el autoguardado antes de crear otro escrito."); return; }
    activeDraftRef.current = null; setActiveDraft(null); setDraftTitle(""); setCaseId(""); setDirty(false); setTab("drafts"); setError(""); setVersions([]); setVersionsOpen(false);
    editor?.commands.setContent(emptyContent, { emitUpdate: false });
    setTimeout(() => document.querySelector<HTMLInputElement>(".legal-draft-title")?.focus(), 0);
  }

  async function toggleVersions() {
    if (!activeDraft) return;
    if (versionsOpen) { setVersionsOpen(false); return; }
    try { setVersions(await listLegalDraftVersions(activeDraft.id)); setVersionsOpen(true); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo cargar el historial de versiones."); }
  }

  function restoreVersion(version: LegalDraftVersion) {
    if (!activeDraft || dirty || saving || !window.confirm("La versión anterior se recuperará como una nueva revisión del borrador. El historial existente no se modifica. ¿Continuar?")) return;
    const updated = { ...activeDraft, title: version.title, content: version.content, caseId: version.caseId };
    activeDraftRef.current = updated; setActiveDraft(updated); setDraftTitle(version.title); setCaseId(version.caseId ?? "");
    editor?.commands.setContent(version.content, { emitUpdate: false }); setDirty(true); setError("");
  }

  async function reloadConflictedDraft() {
    if (!activeDraft || !window.confirm("Se descartarán los cambios locales sin guardar y se cargará la versión que está en el servidor. ¿Continuar?")) return;
    try {
      const latest = (await listLegalDrafts()).find((item) => item.id === activeDraft.id);
      if (!latest) throw new Error("No se encontró el borrador actualizado.");
      activeDraftRef.current = latest; setActiveDraft(latest); setDraftTitle(latest.title); setCaseId(latest.caseId ?? ""); setDirty(false); setConflict(false); setError("");
      editor?.commands.setContent(latest.content, { emitUpdate: false });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo recuperar la versión actual."); }
  }

  function startResize(event: PointerEvent<HTMLDivElement>) {
    dragStart.current = { x: event.clientX, research: sizes.research, editor: sizes.editor };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    if (!start) return;
    const width = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 1200;
    const delta = (event.clientX - start.x) / Math.max(width, 1) * 3.2;
    setSizes({ research: Math.min(1.55, Math.max(.6, start.research + delta)), editor: Math.min(1.6, Math.max(.65, start.editor - delta)) });
  }

  async function saveAnnotation(isNote: boolean) {
    if (!selected) return;
    const excerpt = getSelectionText();
    if (!excerpt) { setError("Seleccioná primero un fragmento del texto mostrado."); return; }
    const user = getClientAuth().currentUser;
    if (!user) { setError("La sesión no está disponible."); return; }
    setError("");
    try {
      await saveLegalAnnotation(selected, excerpt, isNote ? noteText.trim() : "", user);
      setNoteText(""); setAnnotations(await listLegalAnnotations());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar la anotación."); }
  }

  async function insertCitation() {
    if (!selected || !editor) return;
    const excerpt = getSelectionText();
    if (!excerpt) { setError("Seleccioná el fragmento exacto que querés insertar en el escrito."); return; }
    const user = getClientAuth().currentUser;
    if (!user) { setError("La sesión no está disponible."); return; }
    setError("");
    try {
      const citation = await saveLegalCitation(selected, excerpt, user);
      editor.chain().focus().insertContent({ type: "legalCitation", attrs: {
        citationId: citation.id, excerpt: citation.excerpt, source: citation.source, sourceTitle: citation.sourceTitle, caption: citation.caption,
        court: citation.court, decisionDate: citation.decisionDate, jurisdiction: citation.jurisdiction,
        officialUrl: citation.officialUrl, verificationStatus: citation.verificationStatus,
      } }).insertContent({ type: "paragraph" }).run();
      setCitations(await listLegalCitations()); setTab("drafts");
      if (!activeDraft) setError("La cita quedó insertada en el borrador actual. Escribí un título o continuá redactando para autoguardarlo.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo registrar e insertar la cita."); }
  }

  async function registerVersion() {
    const user = getClientAuth().currentUser;
    if (!activeDraft || !user || dirty || saving) { setError("Esperá el autoguardado antes de registrar una versión."); return; }
    try { await registerLegalDraftVersion(activeDraft, user); setError(""); setSavedAt("Versión registrada · " + new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo registrar la versión."); }
  }

  function createDraftFile() {
    const title = (draftTitle.trim() || "Escrito jurídico").replace(/[\\/:*?"<>|]/g, "-");
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{font:12pt/1.65 Georgia,serif;color:#17253b;max-width:800px;margin:48px auto;padding:0 32px}h1,h2,h3{line-height:1.25}blockquote{border-left:3px solid #416182;padding:10px 18px;margin:18px 0;background:#f2f6fb}.legal-citation-reference{font-size:9pt;color:#465b72;margin-top:8px}</style></head><body><h1>${title}</h1>${editor?.getHTML() ?? ""}</body></html>`;
    return new File([html], `${title}.html`, { type: "text/html;charset=utf-8" });
  }

  function downloadDraft() {
    const file = createDraftFile();
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.name; anchor.click();
    URL.revokeObjectURL(url);
  }

  async function beginCloudSave() {
    if (dirty || saving) { setError("Esperá la confirmación del autoguardado antes de exportar el documento."); return; }
    setSavingFile(true); setError("");
    try {
      const [google, microsoft] = await Promise.all([getGoogleDriveStatus(), getOneDriveStatus()]);
      const choices: Array<"google-drive" | "onedrive"> = [...(google.connected ? ["google-drive" as const] : []), ...(microsoft.connected ? ["onedrive" as const] : [])];
      setStorageChoices(choices);
      if (choices.length === 0) { setStorageDialog(true); return; }
      if (choices.length === 1) await saveDraftToCloud(choices[0]);
      else setStorageDialog(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo consultar las cuentas de almacenamiento conectadas."); }
    finally { setSavingFile(false); }
  }

  async function saveDraftToCloud(provider: "google-drive" | "onedrive") {
    setSavingFile(true); setError("");
    try {
      const file = createDraftFile();
      if (provider === "google-drive") await createGoogleDriveUploadSession(file);
      else await uploadOneDriveFile(file);
      setSavedFileAt(`Archivo guardado en ${provider === "google-drive" ? "Google Drive" : "OneDrive"} · ${new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`);
      setStorageDialog(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar el archivo en la cuenta elegida."); }
    finally { setSavingFile(false); }
  }

  async function verifyCitation(citation: LegalCitationSnapshot) {
    const user = getClientAuth().currentUser;
    if (!user || !window.confirm("Confirmá que cotejaste el fragmento y su referencia con el documento de la fuente oficial antes de marcarlo como verificado.")) return;
    try { await markLegalCitationVerified(citation.id, user); setCitations(await listLegalCitations()); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo actualizar la verificación."); }
  }

  const researchStyle = maximized === "editor" ? { display: "none" } : maximized === "research" ? { gridColumn: "1 / -1" } : { gridColumn: "1", minWidth: 0 };
  const editorStyle = maximized === "research" ? { display: "none" } : maximized === "editor" ? { gridColumn: "1 / -1" } : { gridColumn: "3", minWidth: 0 };
  const dividerStyle = maximized ? { display: "none" } : undefined;

  return <main className="panel-main jurisprudence-main">
    <div className="breadcrumbs">Inicio&nbsp; / &nbsp;Gestión jurídica&nbsp; / &nbsp;Fallos y jurisprudencia</div>
    <header className="jurisprudence-heading">
      <div><p className="eyebrow dark">MESA DE INVESTIGACIÓN JURÍDICA</p><h1>Fallos y jurisprudencia</h1><p>Investigá fuentes, conservá citas trazables y redactá en el mismo espacio.</p></div>
      <button type="button" className="button button-light" onClick={newDraft}>＋ Nuevo escrito</button>
    </header>

    <div className="jurisprudence-source-strip">
      <span className="source-status"><i /> Búsqueda multi-fuente mediante Jurídica</span>
      <span className="source-disclaimer">SAIJ, CSJN y JUBA vía Jurídica · cada búsqueda y apertura de detalle consume cuota del proveedor.</span>
      {sourceLinks.map((source) => <a key={source.label} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}
    </div>

    <div className={`jurisprudence-workbench ${maximized ? "is-maximized" : ""}`} style={{ gridTemplateColumns: maximized ? "minmax(0,1fr)" : `minmax(340px, ${sizes.research}fr) 12px minmax(380px, ${sizes.editor}fr)` }}>
      <section className="research-pane" style={researchStyle}>
        <header className="work-pane-heading"><div><span className="eyebrow dark">INVESTIGAR</span><h2>{selected ? "Lectura de fuente" : tab === "library" ? "Biblioteca de citas" : tab === "drafts" ? "Mis escritos" : "Buscar jurisprudencia"}</h2></div><button className="pane-action" onClick={() => setMaximized(maximized === "research" ? null : "research")} aria-label={maximized === "research" ? "Restaurar panel" : "Maximizar investigación"}>{maximized === "research" ? "⤢ Restaurar" : "⛶"}</button></header>
        <nav className="research-tabs" aria-label="Secciones de investigación">
          <button className={tab === "research" ? "active" : ""} onClick={() => { setTab("research"); setSelected(null); }}>Fuentes</button>
          <button className={tab === "library" ? "active" : ""} onClick={() => { setTab("library"); setSelected(null); }}>Mi biblioteca <span>{citations.length}</span></button>
          <button className={tab === "drafts" ? "active" : ""} onClick={() => { setTab("drafts"); setSelected(null); }}>Mis escritos <span>{drafts.length}</span></button>
        </nav>

        {tab === "research" && !selected && <>
          <form className="jurisprudence-search" onSubmit={runSearch}>
            <label htmlFor="jurisprudence-query">Buscar en SAIJ, CSJN y JUBA</label>
            <div className="research-query-row"><input id="jurisprudence-query" value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Tema, carátula, tribunal o texto…" /><button disabled={loading}>{loading ? "Buscando…" : "Buscar"}</button></div>
            <p className="research-provider-note">La búsqueda consulta las fuentes agregadas por Jurídica. No incluye filtros de fuero, jurisdicción o fecha que el contrato de la API no confirme. El proveedor declara que conserva las búsquedas: no ingreses datos identificables ni confidenciales de clientes. <a href="https://juridica.ar/privacidad" target="_blank" rel="noreferrer">Política de privacidad ↗</a></p>
          </form>
          <div className="research-results" aria-live="polite">
            {results.length === 0 ? <div className="workspace-empty"><span>⌕</span><b>{loading ? "Consultando la fuente…" : response ? "Sin resultados para esta búsqueda" : "Todavía no hay una búsqueda"}</b><p>{response ? "Probá otros términos o un tipo de contenido distinto." : "Ingresá términos concretos para consultar la fuente disponible."}</p></div> : <>
              <div className="results-count">{response?.total === null ? `${results.length} resultados recibidos` : `${response?.total ?? results.length} resultados disponibles`} · SAIJ</div>
              {results.map((result, index) => <button className="jurisprudence-result" key={`${result.source ?? "source"}-${result.providerId ?? "record"}-${index}`} onClick={() => void openResult(result)}><span className="result-type">{result.source || "Fuente no identificada"} · {result.type || "Documento"} · {result.jurisdiction || "Jurisdicción no informada"}</span><b>{result.caption || result.title || "Documento sin título informado"}</b><small>{result.court || "Tribunal no informado"} · {formatDate(result.decisionDate)}</small><span className="result-open">Abrir lectura →</span></button>)}
              {response && response.offset + response.count < (response.total ?? 0) && <button className="load-more" disabled={loading} onClick={() => void loadMore()}>{loading ? "Cargando…" : "Cargar más resultados"}</button>}
            </>}
          </div>
        </>}

        {tab === "research" && selected && <article className="source-reader">
          <button className="reader-back" onClick={() => setSelected(null)}>← Volver a resultados <span>Se conservan la búsqueda y los filtros</span></button>
          <div className="reader-meta"><span>FUENTE EXTERNA · {selected.source || "NO IDENTIFICADA POR EL PROVEEDOR"}</span><b>{selected.caption || selected.title || "Documento sin título informado"}</b><p>{selected.court || "Tribunal no informado"} · {formatDate(selected.decisionDate)} · {selected.jurisdiction || "Jurisdicción no informada"}</p>
            {getOfficialUrl(selected.officialUrl) ? <a href={getOfficialUrl(selected.officialUrl)!} target="_blank" rel="noreferrer">Abrir documento oficial ↗</a> : <span className="reader-no-link">El proveedor no informó un enlace oficial utilizable.</span>}
          </div>
          <div className="reader-text" onContextMenu={(event) => { if (getSelectionText()) event.preventDefault(); }}>
            {loading && !selected.text ? <div className="reader-empty">Consultando el detalle del fallo…</div> : selected.text ? <p>{renderAnnotatedText(selected.text, selectedAnnotations)}</p> : <div className="reader-empty">El proveedor no devolvió texto íntegro. Abrí la fuente oficial para consultar el documento.</div>}
          </div>
          <div className="reader-verification-note">La lectura integrada reproduce solamente el contenido recibido del proveedor. Si el texto está incompleto, consultá el original antes de citar. La obtención del detalle es una consulta adicional del cupo diario.</div>
          <div className="reader-actions">
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => void saveAnnotation(false)}>✎ Resaltar selección</button>
            <button onMouseDown={(event) => event.preventDefault()} onClick={() => void insertCitation()}>＋ Insertar cita en el escrito</button>
          </div>
          <div className="annotation-composer"><textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Nota personal para el fragmento seleccionado…" /><button onMouseDown={(event) => event.preventDefault()} onClick={() => void saveAnnotation(true)}>Guardar nota</button></div>
          {selectedAnnotations.length > 0 && <details className="saved-annotations"><summary>Anotaciones guardadas ({selectedAnnotations.length})</summary>{selectedAnnotations.map((item) => <blockquote key={item.id}><p>“{item.excerpt}”</p>{item.note && <small>{item.note}</small>}<time>{formatDate(item.createdAt.slice(0, 10))}</time></blockquote>)}</details>}
        </article>}

        {tab === "library" && <div className="private-list">{citations.length === 0 ? <div className="workspace-empty"><span>▤</span><b>Tu biblioteca está vacía</b><p>Las citas se guardarán desde un fragmento seleccionado en la fuente.</p></div> : citations.map((citation) => <article className="private-list-item" key={citation.id}><span className={`verification-pill ${citation.verificationStatus}`}>{citation.verificationStatus === "verified" ? "Verificada por el profesional" : "Pendiente de verificación"}</span><blockquote>“{citation.excerpt}”</blockquote><b>{citation.caption || citation.sourceTitle || "Referencia sin título"}</b><small>{citation.court || "Tribunal no informado"} · {formatDate(citation.decisionDate)}</small><div className="private-item-actions">{citationSourceLink(citation.officialUrl) && <a href={citationSourceLink(citation.officialUrl)!} target="_blank" rel="noreferrer">Abrir fuente ↗</a>}{citation.verificationStatus === "pending" && <button onClick={() => void verifyCitation(citation)}>Marcar verificada</button>}</div></article>)}</div>}

        {tab === "drafts" && <div className="private-list">{drafts.length === 0 ? <div className="workspace-empty"><span>¶</span><b>No hay escritos guardados</b><p>Creá un escrito; el contenido se guarda automáticamente en el espacio privado del estudio.</p><button onClick={newDraft}>＋ Nuevo escrito</button></div> : drafts.map((draft) => <button key={draft.id} className={`private-draft-row ${activeDraft?.id === draft.id ? "selected" : ""}`} onClick={() => openDraft(draft)}><b>{draft.title || "Escrito sin título"}</b><small>{draft.caseId ? cases.find((item) => item.id === draft.caseId)?.caption ?? "Expediente vinculado" : "Sin expediente asociado"}</small><span>Revisión {draft.revision} · {formatDate(draft.updatedAt.slice(0, 10))}</span></button>)}</div>}
      </section>

      <div className="workbench-divider" style={dividerStyle} role="separator" aria-orientation="vertical" aria-label="Cambiar ancho de los paneles" onPointerDown={startResize} onPointerMove={resize} onPointerUp={() => { dragStart.current = null; }} onPointerCancel={() => { dragStart.current = null; }}><span /></div>

      <section className="editor-pane" style={editorStyle}>
        <header className="work-pane-heading"><div><span className="eyebrow dark">REDACTAR</span><h2>Editor jurídico</h2></div><button className="pane-action" onClick={() => setMaximized(maximized === "editor" ? null : "editor")} aria-label={maximized === "editor" ? "Restaurar panel" : "Maximizar editor"}>{maximized === "editor" ? "⤢ Restaurar" : "⛶"}</button></header>
        <h3 className="print-only-title">{draftTitle || "Escrito jurídico"}</h3>
        <div className="draft-controls"><label htmlFor="draft-title">Título del borrador</label><input className="legal-draft-title" id="draft-title" value={draftTitle} onChange={(event) => { setDraftTitle(event.target.value); setDirty(true); }} placeholder="Ej.: Contestación de demanda" /><label htmlFor="draft-case">Expediente asociado <small>(opcional)</small></label><select id="draft-case" value={caseId} onChange={(event) => { setCaseId(event.target.value); setDirty(true); }}><option value="">Sin expediente asociado</option>{cases.map((item) => <option key={item.id} value={item.id}>{item.number} · {item.caption}</option>)}</select>{currentCaseLabel && <span className="draft-case-note">Vinculado a {currentCaseLabel.number} · {currentCaseLabel.caption}</span>}</div>
        <div className="editor-toolbar" role="toolbar" aria-label="Formato del escrito">
          <button disabled={!editor} aria-label="Negrita" onClick={() => editor?.chain().focus().toggleBold().run()} className={editor?.isActive("bold") ? "active" : ""}><b>B</b></button><button disabled={!editor} aria-label="Cursiva" onClick={() => editor?.chain().focus().toggleItalic().run()} className={editor?.isActive("italic") ? "active" : ""}><i>I</i></button><button disabled={!editor} aria-label="Subrayado" onClick={() => editor?.chain().focus().toggleUnderline().run()} className={editor?.isActive("underline") ? "active" : ""}><u>U</u></button><button disabled={!editor} aria-label="Resaltar texto" onClick={() => editor?.chain().focus().toggleHighlight().run()} className={editor?.isActive("highlight") ? "active" : ""}>▰</button><span /><button disabled={!editor} onClick={() => editor?.chain().focus().toggleBulletList().run()}>• Lista</button><button disabled={!editor} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>❞ Cita común</button><button disabled={!editor} onClick={() => editor?.chain().focus().undo().run()}>↶</button><button disabled={!editor} onClick={() => editor?.chain().focus().redo().run()}>↷</button>
        </div>
        <div className="editor-scroll"><EditorContent editor={editor} /></div>
        <footer className="editor-status"><span>{saving ? "Guardando borrador…" : dirty ? "Cambios pendientes de guardar" : savedAt ? `Borrador guardado · ${savedAt}` : activeDraft ? `Borrador recuperado · revisión ${activeDraft.revision}` : "Borrador nuevo · se guardará al comenzar"}{savedFileAt && <small className="editor-file-status">{savedFileAt}</small>}</span><div><button disabled={!activeDraft || dirty || saving} onClick={() => void registerVersion()}>Registrar versión</button><button disabled={!activeDraft || dirty || saving} onClick={() => void toggleVersions()}>Historial</button><button disabled={dirty || saving || savingFile} onClick={downloadDraft}>Descargar archivo</button><button disabled={dirty || saving || savingFile} onClick={() => void beginCloudSave()}>{savingFile ? "Guardando archivo…" : "Guardar en nube"}</button><button disabled={dirty || saving} onClick={() => window.print()}>Imprimir / PDF</button></div></footer>
        {versionsOpen && <section className="draft-version-history"><header><b>Versiones registradas</b><button onClick={() => setVersionsOpen(false)}>Cerrar</button></header>{versions.length === 0 ? <p>Todavía no hay versiones registradas.</p> : versions.map((version) => <div key={version.id}><span><b>Revisión {version.revision}</b><small>{version.registeredAt ? new Date(version.registeredAt).toLocaleString("es-AR") : "Fecha no disponible"}</small></span><button disabled={dirty || saving} onClick={() => restoreVersion(version)}>Recuperar como nueva revisión</button></div>)}</section>}
      </section>
    </div>

    {error && <div className="jurisprudence-feedback" role="status"><span>{error}</span>{conflict && <button onClick={() => void reloadConflictedDraft()}>Recargar versión del servidor</button>}<button onClick={() => setError("")} aria-label="Cerrar mensaje">×</button></div>}
    {storageDialog && <div className="agenda-overlay" role="presentation"><section className="agenda-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="draft-storage-title"><header className="agenda-dialog-header"><div><span className="agenda-eyebrow">DOCUMENTO DEL ESTUDIO</span><h2 id="draft-storage-title">Elegí dónde guardar el archivo</h2><p>El borrador editable permanece en el editor; este archivo se guarda en la cuenta que selecciones.</p></div><button type="button" className="agenda-icon-button" onClick={() => setStorageDialog(false)} aria-label="Cerrar">×</button></header><div className="agenda-detail-scroll">{storageChoices.length === 0 ? <><p>Para guardar documentos, primero conectá Google Drive o OneDrive.</p><button className="agenda-button primary" onClick={() => { setStorageDialog(false); window.location.assign("/panel/configuracion"); }}>Configurar almacenamiento</button></> : <div className="storage-provider-choice">{storageChoices.includes("google-drive") && <button className="agenda-button secondary" disabled={savingFile} onClick={() => void saveDraftToCloud("google-drive")}>Guardar en Google Drive</button>}{storageChoices.includes("onedrive") && <button className="agenda-button secondary" disabled={savingFile} onClick={() => void saveDraftToCloud("onedrive")}>Guardar en OneDrive</button>}</div>}</div></section></div>}
    <footer className="jurisprudence-footnote">Las fuentes externas conservan su procedencia. El sistema no calcula plazos ni sustituye la revisión profesional de citas y documentos originales.</footer>
  </main>;
}

function renderAnnotatedText(text: string, annotations: LegalAnnotation[]): ReactNode {
  const excerpts = [...new Set(annotations.map((item) => item.excerpt).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!excerpts.length) return text;
  const found = excerpts.map((excerpt) => ({ excerpt, index: text.indexOf(excerpt) })).filter((item) => item.index >= 0).sort((a, b) => a.index - b.index);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const [index, item] of found.entries()) {
    if (item.index < cursor) continue;
    nodes.push(text.slice(cursor, item.index));
    nodes.push(<mark key={`${item.index}-${index}`}>{item.excerpt}</mark>);
    cursor = item.index + item.excerpt.length;
  }
  nodes.push(text.slice(cursor));
  return nodes;
}

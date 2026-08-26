// Globals
let rawDataStore = [];
let networkRegistryStore = [];
let charts = {};
let currentSlide = 0;
const slides = document.querySelectorAll('.slide');

// Cores padronizadas para o tema dark premium
const chartColors = {
    red: '#FF8900',
    green: '#00DBFF',
    blue: '#00DBFF',
    purple: '#A44DFF',
    orange: '#FF8900',
    surface: 'rgba(255, 255, 255, 0.05)',
    text: '#C7D2D8',
    grid: 'rgba(255, 255, 255, 0.08)'
};

Chart.defaults.color = chartColors.text;
Chart.defaults.font.family = 'Verdana, Arial, sans-serif';

// ======= MAPA DE NOMES DE CLIENTE =======
const clientKeywordsMap = {
    "Karsten": ["karsten"],
    "Santa Lolla": ["santa lolla", "degals", "sl"],
    "Cirandinha": ["cirandinha", "sapatu-mania", "gm", "meridian", "godiva", "fort"],
    "Paludo": ["paludo"]
};

function getMasterClientName(rawName) {
    if (!rawName) return "Desconhecido";
    const lowerName = rawName.toString().toLowerCase();

    for (const [masterName, keywords] of Object.entries(clientKeywordsMap)) {
        for (const kw of keywords) {
            // Regras exatas para siglas curtas
            if (kw === "sl" || kw === "gm") {
                const regex = new RegExp(`(^|\\s|-|\\.)${kw}($|\\s|-|\\.)`);
                if (regex.test(lowerName)) {
                    return masterName;
                }
            } else if (lowerName.includes(kw)) {
                return masterName;
            }
        }
    }
    return rawName;
}

function resolveStoreName(row, colApelido) {
    const apelido = colApelido ? row[colApelido] : null;
    if (apelido !== null && apelido !== undefined && String(apelido).trim()) {
        return String(apelido).trim();
    }
    return 'SEM APELIDO';
}

// ======= PERSISTÊNCIA LOCAL (COMPATÍVEL COM GITHUB PAGES) =======
const STORAGE_DB = 'rmr-dashboard-db';
const STORAGE_VERSION = 1;
const STORAGE_STORE = 'dashboard';
const STORAGE_RECORD = 'current';
const PREFS_KEY = 'rmr_preferences_v1';

function openStorageDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(STORAGE_DB, STORAGE_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORAGE_STORE)) db.createObjectStore(STORAGE_STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function dbSet(value) {
    const db = await openStorageDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORAGE_STORE, 'readwrite');
        tx.objectStore(STORAGE_STORE).put(value, STORAGE_RECORD);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

async function dbGet() {
    const db = await openStorageDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORAGE_STORE, 'readonly');
        const request = tx.objectStore(STORAGE_STORE).get(STORAGE_RECORD);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
    });
}

function readPreferences() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
    catch (_) { return {}; }
}

function writePreferences(patch = {}) {
    const current = readPreferences();
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...current, ...patch }));
}

function collectActionPlans() {
    const plans = {};
    document.querySelectorAll('.action-plan-input').forEach(input => {
        const key = input.dataset.storeKey;
        if (key && input.value.trim()) plans[key] = input.value;
    });
    return plans;
}

async function savePersistentState(options = {}) {
    const previous = await dbGet() || {};
    const actionPlans = options.actionPlans !== undefined
        ? options.actionPlans
        : { ...(previous.actionPlans || {}), ...collectActionPlans() };
    const next = {
        version: 1,
        savedAt: new Date().toISOString(),
        rawData: rawDataStore,
        networkRegistry: networkRegistryStore,
        actionPlans
    };
    await dbSet(next);
    writePreferences({
        presentationMonth: document.getElementById('presentation-month').value,
        selectedClient: document.getElementById('client-select').value,
        currentSlide,
        clientLogo: document.getElementById('client-logo-img').src || '',
        empresaLogo: document.getElementById('empresa-logo-img').src || ''
    });
}

function populateClients() {
    if (!rawDataStore.length) return;
    const foundClients = new Set(rawDataStore.map(row => row._masterClientName).filter(name => name && name !== 'Desconhecido'));
    const clientSelect = document.getElementById('client-select');
    clientSelect.innerHTML = '<option value="TODOS">Todos os Clientes (Visão Global)</option>';
    Array.from(foundClients).sort().forEach(client => clientSelect.add(new Option(client, client)));
    document.getElementById('client-select-container').style.display = 'block';
    document.getElementById('btn-start').style.display = 'inline-flex';
    document.getElementById('configuration-export-tools').style.display = 'flex';
}

function normalizeHeaderKey(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function getNetworkRegistryColumns(rows) {
    if (!rows?.length) return null;
    const columns = Object.keys(rows[0]);
    const cnpj = columns.find(column => normalizeHeaderKey(column) === 'cnpjfixo')
        || columns.find(column => normalizeHeaderKey(column) === 'cnpj')
        || columns.find(column => normalizeHeaderKey(column).includes('cnpj'));
    const rede = columns.find(column => normalizeHeaderKey(column) === 'rede');
    const apelido = columns.find(column => normalizeHeaderKey(column) === 'apelido');
    return cnpj && rede && apelido ? { cnpj, rede, apelido } : null;
}

function normalizeNetworkRegistry(rows) {
    const columns = getNetworkRegistryColumns(rows);
    if (!columns) return [];
    return rows.map(row => ({
        cnpj: String(row[columns.cnpj] || '').trim(),
        rede: String(row[columns.rede] || '').trim(),
        apelido: String(row[columns.apelido] || '').trim()
    })).filter(item => item.cnpj && item.rede);
}

function findNetworkRegistryInWorkbook(workbook) {
    const candidates = workbook.SheetNames.map((sheetName, index) => {
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });
        const registry = normalizeNetworkRegistry(rows);
        if (!registry.length) return null;
        const nameBonus = /cadastro|rede|loja|de.?para|base/i.test(sheetName) ? 1000000 : 0;
        const nonPrimaryBonus = index > 0 ? 1000 : 0;
        const uniqueRatio = new Set(registry.map(item => item.cnpj)).size / registry.length;
        return { registry, index, score: nameBonus + nonPrimaryBonus + uniqueRatio * 100 + registry.length / 1000 };
    }).filter(Boolean);

    // A primeira aba continua sendo a base de chamados. Quando houver outra aba
    // compatível, ela é priorizada como cadastro completo de lojas por rede.
    const registryCandidates = candidates.some(candidate => candidate.index > 0)
        ? candidates.filter(candidate => candidate.index > 0)
        : candidates;
    registryCandidates.sort((a, b) => b.score - a.score);
    return registryCandidates[0]?.registry || [];
}

function getRegisteredStoresByNetwork() {
    const storesByNetwork = {};
    networkRegistryStore.forEach(item => {
        if (!storesByNetwork[item.rede]) storesByNetwork[item.rede] = new Set();
        storesByNetwork[item.rede].add(item.cnpj);
    });
    return storesByNetwork;
}

function getOpeningDateColumn(rows = rawDataStore) {
    if (!rows.length) return null;
    const columns = Object.keys(rows[0]);
    return columns.find(column => {
        const name = normalizeHeaderKey(column);
        return name.includes('abertura') || name.includes('criado') || name.includes('criacao');
    }) || columns.find(column => {
        const name = normalizeHeaderKey(column);
        return name.includes('data') && !name.includes('sla') && !name.includes('fechamento') && !name.includes('vencimento');
    }) || columns.find(column => normalizeHeaderKey(column).includes('data')) || null;
}

function getAvailablePresentationMonths() {
    const selectedClient = document.getElementById('client-select')?.value || 'TODOS';
    const rows = selectedClient === 'TODOS'
        ? rawDataStore
        : rawDataStore.filter(row => row._masterClientName === selectedClient);
    const openingColumn = getOpeningDateColumn(rows);
    if (!openingColumn) return [];
    return Array.from(new Set(rows.map(row => toMonthKey(parsePtBrDate(row[openingColumn]))).filter(Boolean))).sort();
}

function setPresentationMonth(preferredMonth = '') {
    const availableMonths = getAvailablePresentationMonths();
    if (!availableMonths.length) return '';
    const selectedMonth = availableMonths.includes(preferredMonth) ? preferredMonth : availableMonths[availableMonths.length - 1];
    const input = document.getElementById('presentation-month');
    if (input._flatpickr) input._flatpickr.setDate(selectedMonth, false, 'Y-m');
    else input.value = selectedMonth;
    writePreferences({ presentationMonth: selectedMonth });
    updatePresentationMonthBadge();
    return selectedMonth;
}

function updatePresentationMonthBadge() {
    const month = document.getElementById('presentation-month')?.value;
    document.getElementById('presentation-month-badge-value').textContent = month ? formatMonth(month) : '-';
}

function restoreLogo(type, value) {
    if (!value) return;
    const img = document.getElementById(`${type}-logo-img`);
    img.src = value;
    img.style.display = 'block';
    document.getElementById(`${type}-logo-hint`).style.display = 'none';
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

async function handleLogoUpload(type, file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return alert('Selecione um arquivo de imagem válido.');
    const value = await readFileAsDataUrl(file);
    restoreLogo(type, value);
    await savePersistentState();
}

async function exportBackup() {
    const stored = await dbGet() || { version: 1, rawData: [], actionPlans: {} };
    stored.actionPlans = { ...(stored.actionPlans || {}), ...collectActionPlans() };
    const backup = { app: 'rmr-dashboard', exportedAt: new Date().toISOString(), data: stored, preferences: readPreferences() };
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rmr-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function importBackup(file) {
    if (!file) return;
    try {
        const backup = JSON.parse(await file.text());
        if (backup.app !== 'rmr-dashboard' || !backup.data || !Array.isArray(backup.data.rawData)) throw new Error('Arquivo incompatível');
        await dbSet(backup.data);
        localStorage.setItem(PREFS_KEY, JSON.stringify(backup.preferences || {}));
        alert('Backup restaurado com sucesso. A página será recarregada.');
        location.reload();
    } catch (error) {
        alert('Não foi possível importar este backup. Verifique se o arquivo foi gerado por este dashboard.');
        console.warn('Backup inválido.', error);
    }
}

async function clearPersistentState() {
    if (!confirm('Apagar a planilha, logos, filtros e planos de ação salvos neste navegador?')) return;
    localStorage.removeItem(PREFS_KEY);
    sessionStorage.clear();
    await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(STORAGE_DB);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
        request.onblocked = resolve;
    });
    location.reload();
}

async function loadPersistentState() {
    try {
        const stored = await dbGet();
        const prefs = readPreferences();
        restoreLogo('client', prefs.clientLogo);
        restoreLogo('empresa', prefs.empresaLogo);
        if (!stored?.rawData?.length) return;

        rawDataStore = stored.rawData;
        networkRegistryStore = Array.isArray(stored.networkRegistry) && stored.networkRegistry.length
            ? stored.networkRegistry
            : normalizeNetworkRegistry(rawDataStore);
        populateClients();
        const clientSelect = document.getElementById('client-select');
        if (prefs.selectedClient && Array.from(clientSelect.options).some(option => option.value === prefs.selectedClient)) {
            clientSelect.value = prefs.selectedClient;
        }
        let preferredMonth = prefs.presentationMonth || '';
        if (!preferredMonth && prefs.dateRange) {
            const legacyDate = prefs.dateRange.split('até').pop();
            preferredMonth = toMonthKey(parsePtBrDate(legacyDate.trim()));
        }
        setPresentationMonth(preferredMonth);
        document.getElementById('upload-status').innerHTML = `<i class="fa-solid fa-database"></i> Dados restaurados deste navegador (${rawDataStore.length} linhas).`;
        window.rmrRestoredPlans = stored.actionPlans || {};

        const savedSlide = Number(prefs.currentSlide || 0);
        if (savedSlide > 0) {
            document.getElementById('nav-controls').style.display = 'flex';
            processAndRenderDashboard();
            goToSlide(Math.min(savedSlide, slides.length - 1));
        }
    } catch (error) {
        console.warn('Não foi possível restaurar os dados locais.', error);
        document.getElementById('upload-status').textContent = 'Não foi possível restaurar os dados salvos.';
    }
}

// ======= SETUP DATEPICKER =======
document.addEventListener('DOMContentLoaded', async () => {
    flatpickr("#presentation-month", {
        locale: "pt",
        plugins: [new monthSelectPlugin({
            shorthand: false,
            dateFormat: "Y-m",
            altFormat: "F de Y",
            theme: "dark"
        })],
        altInput: true,
        onChange: () => {
            writePreferences({ presentationMonth: document.getElementById('presentation-month').value });
            updatePresentationMonthBadge();
        }
    });

    document.getElementById('client-select').addEventListener('change', event => {
        writePreferences({ selectedClient: event.target.value });
        setPresentationMonth(document.getElementById('presentation-month').value);
    });
    document.getElementById('client-logo-upload').addEventListener('change', event => handleLogoUpload('client', event.target.files[0]));
    document.getElementById('empresa-logo-upload').addEventListener('change', event => handleLogoUpload('empresa', event.target.files[0]));
    document.getElementById('btn-export-backup').addEventListener('click', () => exportBackup().catch(error => { console.warn(error); alert('Não foi possível gerar o backup.'); }));
    document.getElementById('btn-import-backup').addEventListener('click', () => document.getElementById('backup-upload').click());
    document.getElementById('backup-upload').addEventListener('change', event => importBackup(event.target.files[0]));
    document.getElementById('btn-clear-storage').addEventListener('click', () => clearPersistentState().catch(error => { console.warn(error); alert('Não foi possível limpar os dados locais.'); }));

    let actionSaveTimer;
    document.addEventListener('input', event => {
        if (!event.target.classList.contains('action-plan-input')) return;
        clearTimeout(actionSaveTimer);
        actionSaveTimer = setTimeout(() => savePersistentState().catch(error => console.warn('Falha ao salvar plano de ação.', error)), 500);
    });

    await loadPersistentState();
});

// ======= NAVIGATION SCRIPT =======
document.getElementById('btn-start').addEventListener('click', () => {
    try {
        if (rawDataStore.length > 0) {
            if (!document.getElementById('presentation-month').value) {
                alert('Selecione o mês principal da apresentação.');
                return;
            }
            savePersistentState().catch(error => console.warn('Falha ao salvar dados.', error));
            document.getElementById('nav-controls').style.display = 'flex';
            processAndRenderDashboard();
            goToSlide(1);
        } else {
            alert("Por favor, importe o arquivo CSV primeiro.");
        }
    } catch (err) {
        alert("Aconteceu um erro ao processar os dados: " + err.message);
        console.error(err);
    }
});

document.getElementById('next-slide').addEventListener('click', () => goToSlide(currentSlide + 1));
document.getElementById('prev-slide').addEventListener('click', () => goToSlide(currentSlide - 1));
document.getElementById('btn-export-pdf').addEventListener('click', exportPresentationToPdf);
document.getElementById('btn-export-html').addEventListener('click', exportPresentationToHtml);

function waitForPaint() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function sanitizeFileName(value) {
    return String(value || 'apresentacao-rmr')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'apresentacao-rmr';
}

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function setExportControls(disabled) {
    document.querySelectorAll('.btn-export').forEach(button => { button.disabled = disabled; });
}

async function prepareDashboardForExport() {
    if (rawDataStore.length) processAndRenderDashboard();
    await new Promise(resolve => setTimeout(resolve, 350));

    Object.values(charts).forEach(chart => {
        if (!chart) return;
        try {
            chart.stop();
            chart.options.animation = false;
            chart.update('none');
        } catch (error) {
            console.warn('Não foi possível estabilizar um gráfico para exportação.', error);
        }
    });
    await waitForPaint();
}

async function capturePresentationSlides(onProgress) {
    const originalSlide = currentSlide;
    const originalScrollX = window.scrollX;
    const originalScrollY = window.scrollY;
    const capturedSlides = [];
    const exportIndexes = Array.from({ length: slides.length - 1 }, (_, index) => index + 1);

    document.body.classList.add('presentation-exporting');

    try {
        await prepareDashboardForExport();
        for (let position = 0; position < exportIndexes.length; position++) {
            const index = exportIndexes[position];
            onProgress(position + 1, exportIndexes.length);
            currentSlide = index;
            updateSlideUI();
            slides[index].scrollTop = 0;
            window.scrollTo(0, 0);
            await waitForPaint();

            const canvas = await html2canvas(document.body, {
                backgroundColor: '#002233',
                scale: 1.25,
                useCORS: true,
                logging: false,
                width: 1600,
                height: 900,
                windowWidth: 1600,
                windowHeight: 900,
                scrollX: 0,
                scrollY: 0
            });
            capturedSlides.push(canvas.toDataURL('image/jpeg', 0.92));
        }
        return capturedSlides;
    } finally {
        currentSlide = originalSlide;
        updateSlideUI();
        window.scrollTo(originalScrollX, originalScrollY);
        document.body.classList.remove('presentation-exporting');
    }
}

async function exportPresentationToPdf() {
    const button = document.getElementById('btn-export-pdf');
    const originalButtonHtml = button.innerHTML;

    if (!window.html2canvas || !window.jspdf?.jsPDF) {
        alert('O recurso de exportação ainda não foi carregado. Verifique a conexão e tente novamente.');
        return;
    }

    setExportControls(true);
    try {
        const images = await capturePresentationSlides((current, total) => {
            button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>${current}/${total}</span>`;
        });
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [297, 167.0625], compress: true });
        images.forEach((image, index) => {
            if (index > 0) pdf.addPage([297, 167.0625], 'landscape');
            pdf.addImage(image, 'JPEG', 0, 0, 297, 167.0625, undefined, 'FAST');
        });
        const clientTitle = document.getElementById('client-name').textContent.replace(/^RMR\s*-\s*/i, '');
        pdf.save(`${sanitizeFileName(`RMR-${clientTitle}`)}.pdf`);
    } catch (error) {
        console.error('Erro ao exportar PDF:', error);
        alert('Não foi possível gerar o PDF. Tente novamente ou reduza o tamanho da janela.');
    } finally {
        setExportControls(false);
        button.innerHTML = originalButtonHtml;
    }
}

function buildStandalonePresentationHtml(images, title) {
    const safeTitle = String(title).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
    const slidesMarkup = images.map((image, index) => `<section class="slide${index === 0 ? ' active' : ''}" aria-label="Slide ${index + 1}"><img src="${image}" alt="Slide ${index + 1}"></section>`).join('');
    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#002233;color:#fff;font-family:Verdana,Arial,sans-serif}.stage{position:relative;width:100%;height:100%;display:grid;place-items:center}.slide{display:none;width:100%;height:100%;align-items:center;justify-content:center}.slide.active{display:flex}.slide img{display:block;width:100%;height:100%;object-fit:contain}.controls{position:fixed;right:22px;bottom:20px;z-index:5;display:flex;align-items:center;gap:8px;padding:7px 9px;background:rgba(0,34,51,.86);border:1px solid rgba(255,255,255,.1);border-radius:12px;backdrop-filter:blur(12px);box-shadow:0 12px 35px rgba(0,0,0,.35)}button{width:36px;height:36px;border:0;border-radius:8px;background:rgba(255,255,255,.08);color:#fff;cursor:pointer;font-size:16px}button:hover{background:rgba(0,219,255,.25)}.counter{min-width:62px;text-align:center;font-size:12px;letter-spacing:.12em;color:#c7d2d8}
@media print{html,body{overflow:visible;background:#fff}.controls{display:none}.stage{display:block}.slide,.slide.active{display:flex;width:100vw;height:100vh;break-after:page;page-break-after:always}.slide img{object-fit:contain}}
</style></head><body><main class="stage">${slidesMarkup}</main><nav class="controls" aria-label="Navegação"><button id="prev" aria-label="Anterior">←</button><span class="counter" id="counter">1 / ${images.length}</span><button id="next" aria-label="Próximo">→</button><button id="full" aria-label="Tela cheia">⛶</button><button id="print" aria-label="Imprimir">⎙</button></nav><script>
const slides=[...document.querySelectorAll('.slide')],counter=document.getElementById('counter');let current=0;function show(index){current=(index+slides.length)%slides.length;slides.forEach((slide,i)=>slide.classList.toggle('active',i===current));counter.textContent=(current+1)+' / '+slides.length}document.getElementById('prev').onclick=()=>show(current-1);document.getElementById('next').onclick=()=>show(current+1);document.getElementById('full').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();document.getElementById('print').onclick=()=>window.print();document.addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key===' ')show(current+1);if(event.key==='ArrowLeft')show(current-1);if(event.key==='Escape'&&document.fullscreenElement)document.exitFullscreen()});
<\/script></body></html>`;
}

async function exportPresentationToHtml() {
    const button = document.getElementById('btn-export-html');
    const originalButtonHtml = button.innerHTML;
    if (!window.html2canvas) {
        alert('O recurso de exportação ainda não foi carregado. Verifique a conexão e tente novamente.');
        return;
    }

    setExportControls(true);
    try {
        const images = await capturePresentationSlides((current, total) => {
            button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>${current}/${total}</span>`;
        });
        const clientTitle = document.getElementById('client-name').textContent.replace(/^RMR\s*-\s*/i, '');
        const title = `RMR — ${clientTitle}`;
        const html = buildStandalonePresentationHtml(images, title);
        downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${sanitizeFileName(title)}.html`);
    } catch (error) {
        console.error('Erro ao exportar HTML:', error);
        alert('Não foi possível gerar a apresentação HTML.');
    } finally {
        setExportControls(false);
        button.innerHTML = originalButtonHtml;
    }
}

// Keyboard navigation
document.addEventListener('keydown', (e) => {
    // Only navigate if the dashboard navigation controls are active/visible
    if (document.getElementById('nav-controls').style.display === 'flex') {
        if (e.key === 'ArrowRight') {
            goToSlide(currentSlide + 1);
        } else if (e.key === 'ArrowLeft') {
            goToSlide(currentSlide - 1);
        }
    }
});

function goToSlide(index) {
    if (index < 0 || index >= slides.length) return;
    currentSlide = index;
    updateSlideUI();
}

function updateSlideUI() {
    slides.forEach((slide, index) => {
        if (index === currentSlide) {
            slide.classList.add('active');
        } else {
            slide.classList.remove('active');
        }
    });
    // Set text out of 6
    document.getElementById('slide-counter').textContent = `${currentSlide + 1} / ${slides.length}`;
    const activeSlide = slides[currentSlide];
    const monthBadge = document.getElementById('presentation-month-badge');
    monthBadge.style.display = currentSlide > 0 && activeSlide?.id !== 'slide-monthly-evolution' ? 'flex' : 'none';
    updatePresentationMonthBadge();
    writePreferences({ currentSlide });
}

// ======= DATA UPLOAD SCRIPT =======
document.getElementById('csv-upload').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size === 0) {
        alert("O arquivo selecionado está vazio (0 bytes). Se ele estiver aberto no Excel, por favor, feche o Excel, salve e tente selecionar novamente.");
        document.getElementById('csv-upload').value = '';
        return;
    }

    document.getElementById('upload-status').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Lendo arquivo...';

    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.csv')) {
        // Leitura de CSV
        Papa.parse(file, {
            header: true,
            skipEmptyLines: 'greedy', // Pula linhas vazias mesmo com espaços
            complete: function (results) {
                handleParsedData(results.data);
            },
            error: function (err) {
                alert("Erro ao ler CSV: " + err.message);
                document.getElementById('upload-status').innerHTML = '';
            }
        });
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        // Leitura de Excel
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                // Pega a primeira aba
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Converte para JSON estilo "header: true"
                // Converte para JSON. "raw: false" garante que datas ("05/08/2025 08:33") sejam lidas exatamente como string e não como número.
                const jsonResult = XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: false });
                const networkRegistry = findNetworkRegistryInWorkbook(workbook);

                handleParsedData(jsonResult, networkRegistry);
            } catch (err) {
                alert("Erro ao ler Excel: " + err.message);
                document.getElementById('upload-status').innerHTML = '';
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        alert("Formato de arquivo não suportado. Use .csv, .xlsx ou .xls");
        document.getElementById('upload-status').innerHTML = '';
    }
});

function handleParsedData(dataArray, networkRegistry = []) {
    if (dataArray && dataArray.length > 0) {
        // Salesforce costuma colocar rodapés ("Confidential Information").
        // Vamos filtrar as linhas para pegar só as que tem pelo menos 3 colunas com valor
        let validData = dataArray.filter(row => {
            let colunasPreenchidas = Object.values(row).filter(val => val !== null && val.toString().trim() !== "");
            return colunasPreenchidas.length >= 3;
        });

        if (validData.length > 0) {
            rawDataStore = validData;
            networkRegistryStore = networkRegistry.length ? networkRegistry : normalizeNetworkRegistry(validData);

            // Encontra coluna nome
            const cols = Object.keys(rawDataStore[0]);
            const colNomeConta = cols.find(c => c.toLowerCase().includes('nome da conta') || c.toLowerCase().includes('cnpj')) || cols[0];

            let foundClients = new Set();
            rawDataStore.forEach(row => {
                const rawName = row[colNomeConta];
                row._masterClientName = getMasterClientName(rawName);
                if (row._masterClientName !== "Desconhecido") {
                    foundClients.add(row._masterClientName);
                }
            });

            // Popula Dropdown
            const clientSelect = document.getElementById('client-select');
            clientSelect.innerHTML = '<option value="TODOS">Todos os Clientes (Visão Global)</option>';
            Array.from(foundClients).sort().forEach(c => {
                clientSelect.innerHTML += `<option value="${c}">${c}</option>`;
            });
            document.getElementById('client-select-container').style.display = 'block';

            document.getElementById('upload-status').innerHTML = '<i class="fa-solid fa-check"></i> Arquivo lido: ' + validData.length + ' linhas.';
            document.getElementById('btn-start').style.display = 'inline-flex';
            document.getElementById('configuration-export-tools').style.display = 'flex';
            setPresentationMonth('');
            savePersistentState({ actionPlans: {} }).catch(error => {
                console.warn('Não foi possível salvar a planilha localmente.', error);
                document.getElementById('upload-status').innerHTML += ' <span style="color:#FF8900">(armazenamento local indisponível)</span>';
            });
        } else {
            document.getElementById('upload-status').innerHTML = '';
            alert("O arquivo foi lido, mas as linhas parecem vazias ou com formato inesperado. Verifique a planilha.");
        }
    } else {
        document.getElementById('upload-status').innerHTML = '';
        alert("O arquivo não contém dados (ou tem apenas o cabeçalho). Verifique o conteúdo.");
    }
}

// ======= DATA PROCESSING SCRIPT =======
function parseIntens(val) {
    if (!val) return 0;
    // se for string "0,30" converte para 0.30
    if (typeof val === 'string') {
        return parseFloat(val.replace(',', '.'));
    }
    return val;
}

// Parses "DD/MM/YYYY HH:MM" to Date object
function parsePtBrDate(dateStr) {
    if (!dateStr) return null;
    let parts = String(dateStr).trim().split(' ');
    let datePart = parts[0];
    let timePart = parts[1] || '00:00';

    let dParts = datePart.split('/');
    if (dParts.length !== 3) {
        if (datePart.includes('-')) {
            let isoParts = datePart.split('-');
            if (isoParts.length === 3) {
                // Assume YYYY-MM-DD
                dParts = [isoParts[2], isoParts[1], isoParts[0]];
            } else return null;
        } else {
            return null;
        }
    }
    let tParts = timePart.split(':');
    let h = parseInt(tParts[0] || '0', 10);
    let m = parseInt(tParts[1] || '0', 10);

    let y = parseInt(dParts[2], 10);
    // adjust 2 digit year
    if (y < 100) y += 2000;

    return new Date(y, parseInt(dParts[1], 10) - 1, parseInt(dParts[0], 10), h, m);
}

function processAndRenderDashboard() {
    const presentationMonth = document.getElementById('presentation-month').value;

    // O Header do Salesforce pode variar. Baseado na sua imagem temos:
    // "Número do caso" | "Assunto" | "Idade do Caso em Dias" | "Data Final SLA" | "Unidade de Negócio" | "Status" | "Tipo" | "Nome da conta"

    // Helper to find column name exactly or loosely
    const cols = Object.keys(rawDataStore[0]);
    // Usa regex agressivo para varrer todo lixo de charset invisível:
    const cleanHeader = (name) => {
        if (!name) return '';
        return String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    };

    const colCnpj = cols.find(c => cleanHeader(c).includes('cnpj'));
    const colNomeConta = cols.find(c => cleanHeader(c).includes('nomedaconta')) || cols.find(c => cleanHeader(c).includes('cliente')) || cols[0];
    const colApelido = cols.find(c => cleanHeader(c) === 'apelido') || null;
    const colStatus = cols.find(c => cleanHeader(c).includes('status') || cleanHeader(c).includes('fase')) || cols[0];
    const colIdade = cols.find(c => cleanHeader(c).includes('idade')) || null;
    const colTipo = cols.find(c => cleanHeader(c).includes('tipo')) || null;
    const colAssunto = cols.find(c => cleanHeader(c).includes('assunto')) || null;
    const colAssuntoEncerramento = cols.find(c => cleanHeader(c).includes('assuntoencerramento')) || null;
    const colRede = cols.find(c => cleanHeader(c).includes('rede')) || null;
    const colModulo = cols.find(c => cleanHeader(c).includes('modulo'));
    const colMotivo = cols.find(c => cleanHeader(c).includes('motivo'));

    // Novas Colunas de Data (Abertura, Fechamento e SLA)
    const colFechamento = cols.find(c => cleanHeader(c).includes('fechamento'));
    const colAbertura = cols.find(c => {
        let n = cleanHeader(c);
        return n.includes('abertura') || n.includes('criado') || n.includes('criacao');
    }) || cols.find(c => {
        let n = cleanHeader(c);
        return n.includes('data') && !n.includes('sla') && !n.includes('fechamento') && !n.includes('vencimento');
    }) || cols.find(c => cleanHeader(c).includes('data'));
    const colSlaFinal = cols.find(c => cleanHeader(c).includes('datafinalsla')) || cols.find(c => cleanHeader(c).includes('sla'));

    let totalCasos = 0;
    let abertos = 0;
    let fechados = 0;
    let contasUnicas = new Set();
    let casosDentroSLA = 0;
    let totalSlaAvaliado = 0;
    let typesCount = {};

    let monthlyData = {}; // Para página 3: Comparativo Mensal
    let accountDetailsMap = {}; // Para página 3: Mapeamento de Rede e Apelido

    // Base do mês principal: alimenta todas as páginas operacionais.
    let dataFiltrada = rawDataStore.filter(row => {
        const dataAbertura = parsePtBrDate(row[colAbertura]);
        return dataAbertura && toMonthKey(dataAbertura) === presentationMonth;
    });

    // Base completa: usada exclusivamente pela visão histórica e pelo comparativo mensal.
    let dataCompleta = rawDataStore;
    const selectedClientEl = document.getElementById('client-select');
    const selectedClient = selectedClientEl ? selectedClientEl.value : "TODOS";

    if (selectedClient && selectedClient !== "TODOS") {
        dataFiltrada = dataFiltrada.filter(row => row._masterClientName === selectedClient);
        dataCompleta = dataCompleta.filter(row => row._masterClientName === selectedClient);

        document.getElementById('client-name').textContent = "RMR - " + selectedClient.toUpperCase();
    }

    if (dataFiltrada.length === 0) {
        alert(`Atenção: não foram encontrados casos para ${formatMonth(presentationMonth)} no cliente selecionado.`);
        return;
    }

    // Calcula KPIs usando a base FILTRADA
    dataFiltrada.forEach(row => {
        totalCasos++;

        const statusStr = (row[colStatus] || '').toString().toLowerCase();
        const isClosed = statusStr.includes('fechado') || statusStr.includes('resolvido') || statusStr.includes('closed') || statusStr === 'fechado' || statusStr === 'resolvido';
        if (isClosed) {
            fechados++;
        } else {
            abertos++;
        }

        const conta = row[colNomeConta];
        const identificadorConta = (colCnpj && row[colCnpj]) ? row[colCnpj] : conta;
        if (identificadorConta) contasUnicas.add(identificadorConta);

        // SLA: Cálculo exato através da Data Final vs Fechamento/Hoje
        let atendeuSLA = true;
        let elegivelSLA = false;

        if (colSlaFinal && row[colSlaFinal]) {
            elegivelSLA = true;
            const dtFinal = parsePtBrDate(row[colSlaFinal]);

            if (isClosed) {
                if (colFechamento && row[colFechamento]) {
                    const dtFechamento = parsePtBrDate(row[colFechamento]);
                    if (dtFechamento && dtFinal && dtFechamento > dtFinal) {
                        atendeuSLA = false;
                    }
                }
            } else {
                // Caso em aberto: checa se hoje já estourou o prazo final
                if (dtFinal && new Date() > dtFinal) {
                    atendeuSLA = false;
                }
            }
        } else if (colIdade) {
            // Regra fallback caso não tenha Data Final SLA mapeada
            elegivelSLA = true;
            let idade = parseIntens(row[colIdade]);
            if (idade > 7) {
                atendeuSLA = false;
            }
        }

        if (elegivelSLA) {
            totalSlaAvaliado++;
            if (atendeuSLA) casosDentroSLA++;
        }

        // Tipos (Incidentes, Dúvidas, etc)
        if (colTipo) {
            let tipo = row[colTipo] || 'Outros';
            typesCount[tipo] = (typesCount[tipo] || 0) + 1;
        }
    });

    // Construindo o Comparativo Mensal com a Base COMPLETA (ignora o range global e deixa comparar tudo no arquivo)
    dataCompleta.forEach(row => {
        let monthKey = 'Desconhecido';
        if (colAbertura && row[colAbertura]) {
            let dateVal = row[colAbertura];
            if (typeof dateVal === 'string') {
                if (dateVal.includes('/')) {
                    // Trata DD/MM/YYYY ou similar
                    let parts = dateVal.split(' ')[0].split('/');
                    if (parts.length === 3) {
                        let y = parts[2];
                        let m = parts[1];
                        if (y.length === 2) y = "20" + y;
                        if (m.length === 1) m = "0" + m;
                        monthKey = `${y}-${m}`; // YYYY-MM
                    }
                } else if (dateVal.includes('-')) {
                    // Trata YYYY-MM-DD
                    let parts = dateVal.split(' ')[0].split('-');
                    if (parts.length === 3) {
                        let y = parts[0];
                        let m = parts[1];
                        if (y.length === 2) y = "20" + y;
                        if (m.length === 1) m = "0" + m;
                        monthKey = `${y}-${m}`; // YYYY-MM
                    }
                }
            }
        }
        
        if (monthKey !== 'Desconhecido') {
            if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = { casos: 0, contas: new Set(), contasMap: {} };
            }
            monthlyData[monthKey].casos++;
            
            const nomeLoja = resolveStoreName(row, colApelido);
            const conta = row[colNomeConta];
            const identificadorConta = (colCnpj && row[colCnpj]) ? row[colCnpj] : conta;
            if (identificadorConta) {
                monthlyData[monthKey].contas.add(identificadorConta);
                monthlyData[monthKey].contasMap[identificadorConta] = (monthlyData[monthKey].contasMap[identificadorConta] || 0) + 1;

                if (!accountDetailsMap[identificadorConta]) {
                    accountDetailsMap[identificadorConta] = {
                        rede: (colRede && row[colRede]) ? row[colRede] : (row._masterClientName !== 'Desconhecido' ? row._masterClientName : '-'),
                        apelido: nomeLoja
                    };
                }
            }
        }
    });

    // Calcula KPIs
    const totalCNPJ = contasUnicas.size;
    const densidade = totalCNPJ > 0 ? (totalCasos / totalCNPJ).toFixed(2) : 0;

    let percSLA = 0;
    if (totalSlaAvaliado > 0) {
        percSLA = ((casosDentroSLA / totalSlaAvaliado) * 100).toFixed(1);
    } else {
        percSLA = 100; // Mock se nenhuma info de SLA pra penalizar existir
    }

    // Render Page 2
    document.getElementById('kpi-total').textContent = totalCasos;
    document.getElementById('kpi-abertos').textContent = abertos;
    document.getElementById('kpi-fechados').textContent = fechados;
    document.getElementById('kpi-cnpj').textContent = totalCNPJ;
    document.getElementById('kpi-densidade').textContent = densidade;

    // Gauge Custom Color
    let pbColor = '#00DBFF';

    document.getElementById('sla-value').textContent = `${percSLA}%`;

    renderGauge(percSLA, pbColor);
    renderMonthlyEvolution(monthlyData);
    renderComparative(monthlyData, accountDetailsMap);

    // Extrai dados e renderiza a Página 4: Volumetria Geral
    renderVolumetria(dataFiltrada, colNomeConta, colApelido, colTipo, colIdade, colCnpj, colRede);
    renderAnalisePagina6(dataFiltrada, colModulo, colMotivo, colAssuntoEncerramento || colAssunto, colTipo);
    renderTopLojas(dataFiltrada, colNomeConta, colApelido, colCnpj, colMotivo, colAssuntoEncerramento || colAssunto, colModulo);

    // Se no futuro você quiser q atualizar o Dropdown recarregue a tela (só adicionar listener no select)
    const selectEl = document.getElementById('client-select');
    if (selectEl) {
        // Remove old listeners to avoid multiple triggers if pressing 'Start' multiple times
        selectEl.onchange = null;
        selectEl.addEventListener('change', () => {
            // Opcional: Renderiza dnv ao trocar na capa para já preparar.
            // Desativado por padrão pq a pessoa precisa dar 'Start' de qualquer jeito.
        });
    }
}

// ======= CHART RENDERERS =======
// Plugin customizado para desenhar texto no Doughnut
const textCenterPlugin = {
    id: 'textCenterPlugin',
    beforeDraw: function (chart) {
        if (chart.config.type !== 'doughnut') return;
        var width = chart.width,
            height = chart.height,
            ctx = chart.ctx;

        ctx.restore();
        var fontSize = (height / 6).toFixed(2); // Texto Gigante
        ctx.font = fontSize + 'px Verdana, Arial, sans-serif';
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";

        var text = chart.data.datasets[0].data[0].toString().replace('.', ',') + "%",
            textX = Math.round((width - ctx.measureText(text).width) / 2),
            textY = height - (height * 0.15); // near bottom

        ctx.fillText(text, textX, textY);

        ctx.font = '16px Verdana, Arial, sans-serif';
        ctx.fontWeight = "bold";
        ctx.fillStyle = "#C7D2D8";
        ctx.fillText("0,00%", width * 0.15 - 10, height - 5);
        ctx.fillText("100,00%", width * 0.85 - 20, height - 5);
        ctx.save();
    }
};

function renderGauge(perc, color) {
    const ctx = document.getElementById('slaGauge').getContext('2d');
    if (charts.gauge) charts.gauge.destroy();

    charts.gauge = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Dentro do SLA', 'Fora do SLA'],
            datasets: [{
                data: [perc, 100 - perc],
                backgroundColor: [color, 'rgba(255,255,255,0.10)'],
                borderWidth: 0,
                circumference: 180,
                rotation: 270,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%',
            layout: { padding: { bottom: 20 } },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            }
        },
        plugins: [textCenterPlugin]
    });
}



// Globally store monthly data for drop-down re-renders
let globalMonthlyData = {};
let globalAccountDetailsMap = {};

function buildContinuousMonthKeys(monthlyData) {
    const available = Object.keys(monthlyData).filter(key => /^\d{4}-\d{2}$/.test(key)).sort();
    if (!available.length) return [];

    const [startYear, startMonth] = available[0].split('-').map(Number);
    const [endYear, endMonth] = available[available.length - 1].split('-').map(Number);
    const cursor = new Date(startYear, startMonth - 1, 1);
    const end = new Date(endYear, endMonth - 1, 1);
    const keys = [];

    while (cursor <= end && keys.length < 240) {
        keys.push(toMonthKey(cursor));
        cursor.setMonth(cursor.getMonth() + 1);
    }
    return keys;
}

function renderMonthlyEvolution(monthlyData) {
    const monthKeys = buildContinuousMonthKeys(monthlyData);
    const tableBody = document.getElementById('monthly-evolution-table-body');
    if (!tableBody) return;

    const series = monthKeys.map((key, index) => {
        const month = monthlyData[key] || { casos: 0, contas: new Set() };
        const cases = Number(month.casos || 0);
        const accounts = month.contas instanceof Set ? month.contas.size : 0;
        const density = accounts > 0 ? cases / accounts : 0;
        const previousCases = index > 0 ? Number(monthlyData[monthKeys[index - 1]]?.casos || 0) : null;
        const change = previousCases === null ? null : (previousCases === 0 ? (cases > 0 ? null : 0) : ((cases - previousCases) / previousCases) * 100);
        return { key, cases, accounts, density, change };
    });

    const totalCases = series.reduce((sum, item) => sum + item.cases, 0);
    const averageCases = series.length ? totalCases / series.length : 0;
    const peak = series.reduce((best, item) => !best || item.cases > best.cases ? item : best, null);
    const latest = series[series.length - 1];

    document.getElementById('monthly-total-cases').textContent = totalCases.toLocaleString('pt-BR');
    document.getElementById('monthly-average-cases').textContent = averageCases.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    document.getElementById('monthly-peak').textContent = peak ? `${formatMonth(peak.key).replace(' de ', '/')} · ${peak.cases}` : '-';
    document.getElementById('monthly-last-change').textContent = latest?.change === null || latest?.change === undefined
        ? 'Sem base'
        : `${latest.change >= 0 ? '+' : ''}${latest.change.toFixed(1).replace('.', ',')}%`;
    document.getElementById('monthly-last-change').className = latest?.change > 0
        ? 'monthly-evolution-delta-positive'
        : latest?.change < 0 ? 'monthly-evolution-delta-negative' : 'monthly-evolution-delta-neutral';

    tableBody.innerHTML = series.slice().reverse().map(item => {
        const changeLabel = item.change === null ? '—' : `${item.change >= 0 ? '+' : ''}${item.change.toFixed(1).replace('.', ',')}%`;
        const changeClass = item.change > 0 ? 'monthly-evolution-delta-positive' : item.change < 0 ? 'monthly-evolution-delta-negative' : 'monthly-evolution-delta-neutral';
        return `<tr>
            <td>${formatMonth(item.key).replace(' de ', '/')}</td>
            <td>${item.cases.toLocaleString('pt-BR')}</td>
            <td>${item.density.toFixed(2).replace('.', ',')}</td>
            <td class="${changeClass}">${changeLabel}</td>
        </tr>`;
    }).join('');

    const canvas = document.getElementById('chartMonthlyEvolution');
    if (!canvas || !monthKeys.length) return;
    if (charts.monthlyEvolution) charts.monthlyEvolution.destroy();

    charts.monthlyEvolution = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: series.map(item => {
                const [year, month] = item.key.split('-').map(Number);
                return new Date(year, month - 1, 1).toLocaleString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
            }),
            datasets: [
                {
                    type: 'bar',
                    label: 'Casos abertos',
                    data: series.map(item => item.cases),
                    backgroundColor: 'rgba(0, 219, 255, .78)',
                    hoverBackgroundColor: '#00DBFF',
                    borderRadius: 5,
                    borderSkipped: false,
                    maxBarThickness: 38,
                    yAxisID: 'y'
                },
                {
                    type: 'line',
                    label: 'Densidade',
                    data: series.map(item => Number(item.density.toFixed(2))),
                    borderColor: '#A44DFF',
                    backgroundColor: '#A44DFF',
                    pointBackgroundColor: '#002233',
                    pointBorderColor: '#A44DFF',
                    pointBorderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    borderWidth: 2.5,
                    tension: .32,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#002233',
                    padding: 12,
                    callbacks: {
                        label: context => context.dataset.yAxisID === 'y1'
                            ? ` Densidade: ${Number(context.raw).toFixed(2).replace('.', ',')}`
                            : ` Casos abertos: ${context.raw}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { color: '#C7D2D8', maxRotation: 0, autoSkip: true, maxTicksLimit: 14, font: { size: 10 } }
                },
                y: {
                    beginAtZero: true,
                    position: 'left',
                    grid: { color: 'rgba(255,255,255,.08)' },
                    border: { display: false },
                    ticks: { color: '#C7D2D8', precision: 0, font: { size: 10 } },
                    title: { display: true, text: 'Casos abertos', color: '#C7D2D8', font: { size: 10 } }
                },
                y1: {
                    beginAtZero: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    border: { display: false },
                    ticks: { color: '#A44DFF', font: { size: 10 } },
                    title: { display: true, text: 'Casos por conta', color: '#A44DFF', font: { size: 10 } }
                }
            }
        }
    });
}

function formatMonth(yyyy_mm) {
    if (!yyyy_mm || yyyy_mm === 'Desconhecido') return yyyy_mm;
    const parts = yyyy_mm.split('-');
    if (parts.length < 2) return yyyy_mm;
    const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
    let str = date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function toMonthKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getComparisonMonths(months) {
    const selectedPresentationMonth = document.getElementById('presentation-month')?.value;
    const baseMonth = selectedPresentationMonth || months[0];

    const [year, month] = baseMonth.split('-').map(Number);
    const previousMonth = toMonthKey(new Date(year, month - 2, 1));
    return { baseMonth, previousMonth };
}

function renderComparative(monthlyData, accountDetailsMap = {}) {
    globalMonthlyData = monthlyData;
    globalAccountDetailsMap = accountDetailsMap;
    // Pega meses válidos, ordena de forma descrescente (mais recente primeiro)
    const months = Object.keys(monthlyData).filter(m => m !== 'Desconhecido').sort().reverse();

    if (months.length === 0) {
        document.getElementById('comparative-container').innerHTML = `<div class="empty-state" style="width: 100%; text-align: center; margin-top: 50px;"><i class="fa-solid fa-code-compare" style="font-size: 40px; margin-bottom: 20px;"></i><p>Não foi possível encontrar datas válidas no arquivo para criar o comparativo.</p></div>`;
        return;
    }

    const selBase = document.getElementById('sel-mes-base');
    const selComp = document.getElementById('sel-mes-comp');

    if (selBase._flatpickr) selBase._flatpickr.destroy();
    if (selComp._flatpickr) selComp._flatpickr.destroy();

    const { baseMonth: defaultBase, previousMonth: defaultComp } = getComparisonMonths(months);

    selBase.value = defaultBase;
    selComp.value = defaultComp;

    // Cada campo precisa da sua própria instância do plugin para não duplicar o mês.
    const createFlatpickrConfig = () => ({
        locale: "pt",
        plugins: [
            new monthSelectPlugin({
                shorthand: false, // Falso = "Janeiro", True = "Jan"
                dateFormat: "Y-m", // Como é guardado no input.value
                altFormat: "F de Y", // Como o usuário lê na caixa
                theme: "dark"
            })
        ],
        altInput: true,
        onChange: updateComparativeUI
    });

    const basePicker = flatpickr(selBase, createFlatpickrConfig());
    const compPicker = flatpickr(selComp, createFlatpickrConfig());
    basePicker.setDate(defaultBase, false, 'Y-m');
    compPicker.setDate(defaultComp, false, 'Y-m');
    // Initial render
    updateComparativeUI();
}

function updateComparativeUI() {
    const mBaseKey = document.getElementById('sel-mes-base').value;
    const mCompKey = document.getElementById('sel-mes-comp').value;

    const dataBase = globalMonthlyData[mBaseKey] || { casos: 0, contas: new Set(), contasMap: {} };
    const dataComp = globalMonthlyData[mCompKey] || { casos: 0, contas: new Set(), contasMap: {} };

    // Update Headers
    document.getElementById('lbl-mes-base').textContent = formatMonth(mBaseKey);
    document.getElementById('lbl-mes-comp').textContent = formatMonth(mCompKey);

    // Update KPI Base
    const baseCNPJ = dataBase.contas.size;
    const baseCasos = dataBase.casos;
    const baseDens = baseCNPJ > 0 ? (baseCasos / baseCNPJ).toFixed(2) : '0,00';
    document.getElementById('base-cnpj').textContent = baseCNPJ;
    document.getElementById('base-casos').textContent = baseCasos;
    document.getElementById('base-densidade').textContent = baseDens;

    // Update KPI Comp
    const compCNPJ = dataComp.contas.size;
    const compCasos = dataComp.casos;
    const compDens = compCNPJ > 0 ? (compCasos / compCNPJ).toFixed(2) : '0,00';
    document.getElementById('comp-cnpj').textContent = compCNPJ;
    document.getElementById('comp-casos').textContent = compCasos;
    document.getElementById('comp-densidade').textContent = compDens;

    // Update Diff Table
    const diffCnpjQtd = baseCNPJ - compCNPJ;
    const diffCnpjPerc = compCNPJ > 0 ? ((diffCnpjQtd / compCNPJ) * 100).toFixed(2) + '%' : '0%';
    const diffCasoQtd = baseCasos - compCasos;
    const diffCasoPerc = compCasos > 0 ? ((diffCasoQtd / compCasos) * 100).toFixed(2) + '%' : '0%';

    document.getElementById('diff-cnpj-qtd').textContent = diffCnpjQtd > 0 ? '+' + diffCnpjQtd : diffCnpjQtd;
    document.getElementById('diff-cnpj-perc').textContent = diffCnpjQtd > 0 ? '+' + diffCnpjPerc : diffCnpjPerc;
    document.getElementById('diff-caso-qtd').textContent = diffCasoQtd > 0 ? '+' + diffCasoQtd : diffCasoQtd;
    document.getElementById('diff-caso-perc').textContent = diffCasoQtd > 0 ? '+' + diffCasoPerc : diffCasoPerc;

    // Cor dos destaques de Diff
    document.getElementById('diff-cnpj-qtd').style.color = diffCnpjQtd > 0 ? '#FF8900' : (diffCnpjQtd < 0 ? '#00DBFF' : 'white');
    document.getElementById('diff-cnpj-perc').style.color = diffCnpjQtd > 0 ? '#FF8900' : (diffCnpjQtd < 0 ? '#00DBFF' : 'white');
    document.getElementById('diff-caso-qtd').style.color = diffCasoQtd > 0 ? '#FF8900' : (diffCasoQtd < 0 ? '#00DBFF' : 'white');
    document.getElementById('diff-caso-perc').style.color = diffCasoQtd > 0 ? '#FF8900' : (diffCasoQtd < 0 ? '#00DBFF' : 'white');

    // Prepare Right Table CNPJ Array
// ================= NOVA LÓGICA (BASE + M-1) =================

let cnpjArray = [];

const allKeys = new Set([
    ...Object.keys(dataBase.contasMap),
    ...Object.keys(dataComp.contasMap)
]);

let totalTableDiff = 0;
let totalTableCasos = 0;

allKeys.forEach(nome => {
    const baseCount = dataBase.contasMap[nome] || 0;
    const compCount = dataComp.contasMap[nome] || 0;

    const diffCasos = baseCount - compCount;

    cnpjArray.push({
        nome: nome,
        diff: diffCasos,
        casos: baseCount
    });
});

totalTableDiff = dataBase.casos - dataComp.casos;
totalTableCasos = dataBase.casos;

// Filtra para o ranking do Mês Base
cnpjArray = cnpjArray.filter(item => item.casos > 0);

// Sort by cases descending (Ranking Mês Base)
cnpjArray.sort((a, b) => b.casos - a.casos);

// 🔥 LIMITA PARA PERFORMANCE
cnpjArray = cnpjArray.slice(0, 20);

    let html = '';
    cnpjArray.forEach(item => {
        // Se a diferença for positiva (aumentou chamados), usa vermelho/laranja. Se diminuiu, usa verde.
        let diffColor = item.diff > 0 ? '#FF8900' : (item.diff < 0 ? '#00DBFF' : 'var(--text-muted)');
        let diffText = item.diff > 0 ? '+' + item.diff : item.diff;

        let detalhes = globalAccountDetailsMap[item.nome] || { rede: '-', apelido: 'SEM APELIDO' };

        html += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding: 12px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;" title="${detalhes.rede}">${detalhes.rede}</td>
                <td style="padding: 12px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;" title="${detalhes.apelido}">${detalhes.apelido}</td>
                <td style="padding: 12px 8px; text-align: center; color: ${diffColor}; font-weight: bold;">${diffText}</td>
                <td style="padding: 12px 8px; text-align: right;">${item.casos}</td>
            </tr>
        `;
    });

    if (cnpjArray.length === 0) {
        html = `<tr><td colspan="4" style="padding: 20px; text-align: center; color: var(--text-muted);">Nenhum CNPJ com chamado no Mês Base</td></tr>`;
    }

    document.getElementById('cnpj-table-body').innerHTML = html;

    let totalTableDiffColor = totalTableDiff > 0 ? '#FF8900' : (totalTableDiff < 0 ? '#00DBFF' : 'white');
    let totalTableDiffText = totalTableDiff > 0 ? '+' + totalTableDiff : totalTableDiff;

    document.getElementById('table-total-diff').textContent = totalTableDiffText;
    document.getElementById('table-total-diff').style.color = totalTableDiffColor;
    document.getElementById('table-total-casos').textContent = totalTableCasos;

    // ================= NOVA LÓGICA (REDES) =================
    let redeStats = {};
    const registeredStoresByNetwork = getRegisteredStoresByNetwork();

    allKeys.forEach(cnpj => {
        const baseCount = dataBase.contasMap[cnpj] || 0;
        const compCount = dataComp.contasMap[cnpj] || 0;
        const detalhes = globalAccountDetailsMap[cnpj] || { rede: '-', apelido: 'SEM APELIDO' };
        // Agrupa por Rede. Se a conta não tiver Rede mapeada, usa o Apelido como rótulo de contingência.
        const redeName = (detalhes.rede && detalhes.rede !== '-') ? detalhes.rede : detalhes.apelido;

        if (!redeStats[redeName]) {
            redeStats[redeName] = { base: 0, comp: 0 };
        }
        redeStats[redeName].base += baseCount;
        redeStats[redeName].comp += compCount;
    });

    let redeArray = Object.keys(redeStats).map(k => {
        return {
            rede: k,
            lojasQtde: registeredStoresByNetwork[String(k).trim()]?.size || 0,
            base: redeStats[k].base,
            comp: redeStats[k].comp,
            diff: redeStats[k].base - redeStats[k].comp
        }
    });

    // Filtra quem não tem nenhum caso e ordena pelo Mês Base (Decrescente)
    redeArray = redeArray.filter(item => item.base > 0 || item.comp > 0);
    redeArray.sort((a, b) => b.base - a.base);

    let redeHtml = '';
    redeArray.forEach(item => {
        let diffColor = item.diff > 0 ? '#FF8900' : (item.diff < 0 ? '#00DBFF' : 'var(--text-muted)');
        let diffText = item.diff > 0 ? '+' + item.diff : item.diff;

        redeHtml += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                <td style="padding: 12px 8px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;" title="${item.rede}">${item.rede}</td>
                <td style="padding: 12px 8px; text-align: center;">${item.lojasQtde}</td>
                <td style="padding: 12px 8px; text-align: center;">${item.comp}</td>
                <td style="padding: 12px 8px; text-align: center;">${item.base}</td>
                <td style="padding: 12px 8px; text-align: center; color: ${diffColor}; font-weight: bold;">${diffText}</td>
            </tr>
        `;
    });

    if (redeArray.length === 0) {
        redeHtml = `<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">Nenhuma Rede com chamados no período</td></tr>`;
    }
    
    let redeTableBody = document.getElementById('rede-table-body');
    if(redeTableBody) redeTableBody.innerHTML = redeHtml;

    // Chart de Redes Lado a Lado (Top 10)
    let topRedes = redeArray.slice(0, 10);
    const canvasRedes = document.getElementById('chartRedes');
    if(canvasRedes) {
        const ctxRedes = canvasRedes.getContext('2d');
        if (charts.redes) charts.redes.destroy();
        
        const baseLabel = formatMonth(mBaseKey);
        const compLabel = formatMonth(mCompKey);

        charts.redes = new Chart(ctxRedes, {
            type: 'bar',
            data: {
                labels: topRedes.map(r => r.rede),
                datasets: [
                    {
                        label: compLabel + ' (M-1)',
                        data: topRedes.map(r => r.comp),
                        backgroundColor: '#A44DFF',
                        borderRadius: 4
                    },
                    {
                        label: baseLabel + ' (Base)',
                        data: topRedes.map(r => r.base),
                        backgroundColor: '#00DBFF',
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        labels: { color: '#C7D2D8', font: { family: 'Verdana, Arial, sans-serif' } }
                    },
                    tooltip: {
                        backgroundColor: '#002233',
                        titleFont: { family: 'Verdana, Arial, sans-serif', size: 14 },
                        bodyFont: { family: 'Verdana, Arial, sans-serif', size: 14 }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false, drawBorder: false },
                        ticks: { color: '#C7D2D8', font: { family: 'Verdana, Arial, sans-serif' } }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.08)', drawBorder: false },
                        ticks: { color: '#C7D2D8', font: { family: 'Verdana, Arial, sans-serif' } }
                    }
                }
            }
        });
    }
}

// ======= VOLUMETRIA GERAL (PAGE 4) =======
function renderVolumetria(data, colNomeConta, colApelido, colTipo, colIdade, colCnpj, colRede, tempoFiltradoParam) {
    let marcasMap = {};
    let tiposCount = { 'Dúvida': 0, 'Incidente': 0, 'Requisição': 0, 'Serviço': 0, 'Manutenção': 0, 'Outros': 0 };

    let sumIdadeResolvidos = 0;
    let countResolvidos = 0;

    data.forEach(row => {
        // 1. Marca/Loja Aggregation
        const nomeLoja = resolveStoreName(row, colApelido);
        const marcaRaw = row[colNomeConta] || 'Desconhecido';
        const chaveLoja = marcaRaw.toString().toUpperCase().trim();

        if (!marcasMap[chaveLoja]) {
            marcasMap[chaveLoja] = { 
                rede: (colRede && row[colRede]) ? row[colRede] : (row._masterClientName !== 'Desconhecido' ? row._masterClientName : '-'),
                apelido: nomeLoja,
                total: 0, 
                abertos: 0, 
                fechados: 0, 
                cnpjs: new Set() 
            };
        }

        let mObj = marcasMap[chaveLoja];
        mObj.total++;

        // Search globally unmapped status key to double check if needed, but we rely on string search since we don't have colStatus mapped here directly
        const rawStatus = Object.values(row).find(v => typeof v === 'string' && (v.toLowerCase().includes('fechado') || v.toLowerCase().includes('resolvido') || v.toLowerCase().includes('closed') || v.toLowerCase() === 'fechado' || v.toLowerCase() === 'resolvido'));

        let isFechado = false;

        if (rawStatus) {
            isFechado = true;
            mObj.fechados++;
        } else {
            // Check based on original isClosed logic:
            // Let's iterate all keys to find status exactly to reuse logic
            let foundStatus = Object.keys(row).find(k => k.replace(/[^a-zA-Z]/g, '').toLowerCase().includes('status'));
            if (foundStatus) {
                let sVal = String(row[foundStatus]).toLowerCase();
                isFechado = sVal.includes('fechado') || sVal.includes('resolvido') || sVal.includes('closed') || sVal === 'fechado' || sVal === 'resolvido';
            }
            if (isFechado) mObj.fechados++; else mObj.abertos++;
        }

        const identificadorConta = (colCnpj && row[colCnpj]) ? row[colCnpj] : marcaRaw;
        if (identificadorConta) mObj.cnpjs.add(identificadorConta);

        // 2. Tipos de Chamado
        if (colTipo) {
            let tipoRaw = (row[colTipo] || 'Outros').toString().trim();
            // Normalizar os piores ofensores para bater com o layout bonito
            let tipoL = tipoRaw.toLowerCase();
            let tipoGroup = 'Outros';
            if (tipoL.includes('dúvida') || tipoL.includes('duvida')) tipoGroup = 'Dúvida';
            else if (tipoL.includes('incidente') || tipoL.includes('erro')) tipoGroup = 'Incidente';
            else if (tipoL.includes('requisição') || tipoL.includes('requisicao') || tipoL.includes('request')) tipoGroup = 'Requisição';
            else if (tipoL.includes('serviço') || tipoL.includes('servico')) tipoGroup = 'Serviço';
            else if (tipoL.includes('manutenção') || tipoL.includes('manutencao')) tipoGroup = 'Manutenção';
            else tipoGroup = tipoRaw; // Mantem original se for algo novo

            tiposCount[tipoGroup] = (tiposCount[tipoGroup] || 0) + 1;
        }

        // 3. TMS (Idade de Casos Fechados)
        if (isFechado && colIdade) {
            let idade = parseIntens(row[colIdade]);
            sumIdadeResolvidos += idade;
            countResolvidos++;
        }
    });

    // --- Render TMS ---
    let tms = countResolvidos > 0 ? (sumIdadeResolvidos / countResolvidos).toFixed(2) : "0,00";
    document.getElementById('vol-tms').textContent = tms.replace('.', ',');

    // --- Render Tabela de Marcas ---
    // The total time span is the count of days filtered explicitly passed to avoid text-regex errors
    let tempoFiltrado = tempoFiltradoParam || 1;

    let marcasArray = Object.keys(marcasMap).map(k => {
        let obj = marcasMap[k];
        let densidade = (obj.total / tempoFiltrado).toFixed(2);
        return { nome: k, rede: obj.rede, apelido: obj.apelido, total: obj.total, abertos: obj.abertos, fechados: obj.fechados, densidade: densidade, rawCnpjs: obj.cnpjs.size };
    });

    marcasArray.sort((a, b) => b.total - a.total); // Sort by highest vol

    let tHtml = '';
    let gTot = 0, gAb = 0, gFe = 0;
    marcasArray.forEach(m => {
        gTot += m.total; gAb += m.abertos; gFe += m.fechados;
        tHtml += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                <td style="padding: 10px 5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;" title="${m.rede}">${m.rede}</td>
                <td style="padding: 10px 5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;" title="${m.apelido}">${m.apelido}</td>
                <td style="padding: 10px 5px; text-align: center;">${m.total}</td>
                <td style="padding: 10px 5px; text-align: center; color: ${m.abertos > 0 ? '#FF8900' : 'inherit'};">${m.abertos}</td>
                <td style="padding: 10px 5px; text-align: center;">${m.fechados}</td>
                <td style="padding: 10px 5px; text-align: center;">${m.densidade}</td>
            </tr>
        `;
    });
    document.getElementById('table-marcas-body').innerHTML = tHtml;
    document.getElementById('tot-marca-casos').textContent = gTot;
    document.getElementById('tot-marca-abertos').textContent = gAb;
    document.getElementById('tot-marca-fech').textContent = gFe;
    document.getElementById('tot-marca-dens').textContent = (gTot / tempoFiltrado).toFixed(2);

    // --- Render Gráfico de Tipos ---
    // Remove empty types
    for (let k in tiposCount) { if (tiposCount[k] === 0) delete tiposCount[k]; }

    // Sort types by size
    let sortedTipos = Object.entries(tiposCount).sort((a, b) => b[1] - a[1]);
    let labelsTipo = sortedTipos.map(i => i[0]);
    let dataTipo = sortedTipos.map(i => i[1]);

    const ctxTipos = document.getElementById('chartTipos').getContext('2d');
    if (charts.tipos) charts.tipos.destroy();

    charts.tipos = new Chart(ctxTipos, {
        type: 'bar',
        data: {
            labels: labelsTipo,
            datasets: [{
                label: 'Chamados',
                data: dataTipo,
                backgroundColor: '#00DBFF',
                borderRadius: 4,
                barPercentage: 0.6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#002233',
                    titleFont: { family: 'Verdana, Arial, sans-serif', size: 14 },
                    bodyFont: { family: 'Verdana, Arial, sans-serif', size: 14 }
                }
            },
            scales: {
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: { color: '#C7D2D8', font: { family: 'Verdana, Arial, sans-serif' } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.08)', drawBorder: false },
                    ticks: { color: '#C7D2D8', font: { family: 'Verdana, Arial, sans-serif' } }
                }
            }
        }
    });

}

// ======= ANÁLISE DE CAUSA RAIZ (PÁGINA 6) =======
function renderAnalisePagina6(data, colModulo, colMotivo, colAssunto, colTipo) {

    // --- 1. Módulos ---
    if (colModulo) {
        let moduloCount = {};
        data.forEach(row => {
            const rawModulo = (row[colModulo] || '').toString().trim();
            if (rawModulo) {
                moduloCount[rawModulo] = (moduloCount[rawModulo] || 0) + 1;
            }
        });

        let sortedModulos = Object.entries(moduloCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
        let labelsModulo = sortedModulos.map(i => i[0]);
        let dataModulo = sortedModulos.map(i => i[1]);

        const ctxModulos = document.getElementById('chartModulos').getContext('2d');
        if (charts.modulos) charts.modulos.destroy();

        charts.modulos = new Chart(ctxModulos, {
            type: 'bar',
            data: {
                labels: labelsModulo,
                datasets: [{
                    label: 'Acionamentos',
                    data: dataModulo,
                    backgroundColor: chartColors.blue,
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: chartColors.grid }, ticks: { color: chartColors.text } },
                    y: { grid: { display: false }, ticks: { color: chartColors.text, font: { size: 12 } } }
                }
            }
        });
    }

    // --- 2. Motivos ---
    if (colMotivo) {
        let motivoCount = {};
        data.forEach(row => {
            const rawMotivo = (row[colMotivo] || 'Não especificado').toString().trim();
            if (rawMotivo) {
                motivoCount[rawMotivo] = (motivoCount[rawMotivo] || 0) + 1;
            }
        });

        let sortedMotivos = Object.entries(motivoCount).sort((a, b) => b[1] - a[1]);
        let labelsMotivo = sortedMotivos.map(i => i[0]);
        let dataMotivo = sortedMotivos.map(i => i[1]);

        const ctxMotivos = document.getElementById('chartMotivos').getContext('2d');
        if (charts.motivos) charts.motivos.destroy();

        charts.motivos = new Chart(ctxMotivos, {
            type: 'doughnut',
            data: {
                labels: labelsMotivo,
                datasets: [{
                    label: 'Motivos',
                    data: dataMotivo,
                    backgroundColor: ['#00DBFF', '#A44DFF', '#FF8900', '#6EEBFF', '#C184FF', '#7A8B94'],
                    borderWidth: 0,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: chartColors.text,
                            padding: 15,
                            font: { size: 12 }
                        }
                    }
                }
            }
        });
    }

    // --- 3. Assuntos de Encerramento (Lógica existente) ---
    if (colAssunto) {
        let assuntosCount = {};
        data.forEach(row => {
            const rawAssunto = (row[colAssunto] || '').toString().trim();

            // A lógica original filtrava por tipo. Vamos manter para consistência.
            let isRelevantType = true;
            if (colTipo) {
                const rawTipo = (row[colTipo] || '').toString().toLowerCase().trim();
                isRelevantType = rawTipo.includes('dúvida') || rawTipo.includes('duvida') || rawTipo.includes('incidente') || rawTipo.includes('incidentes');
            }

            if (isRelevantType && rawAssunto) {
                assuntosCount[rawAssunto] = (assuntosCount[rawAssunto] || 0) + 1;
            }
        });

        let sortedAssuntos = Object.entries(assuntosCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
        let labelsAssunto = sortedAssuntos.map(i => i[0]);
        let dataAssunto = sortedAssuntos.map(i => i[1]);

        const ctxAssuntos = document.getElementById('chartAssuntos').getContext('2d');
        if (charts.assuntos) charts.assuntos.destroy();

        charts.assuntos = new Chart(ctxAssuntos, {
            type: 'bar',
            data: {
                labels: labelsAssunto,
                datasets: [{
                    label: 'Ocorrências',
                    data: dataAssunto,
                    backgroundColor: chartColors.blue,
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return ` ${context.raw} chamados`;
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { color: chartColors.grid }, ticks: { color: chartColors.text, precision: 0 } },
                    y: { grid: { display: false }, ticks: { color: chartColors.text, font: { size: 12 } } }
                }
            }
        });
    }
}

// ======= TOP OFENSORES (PÁGINA 7) =======
function renderTopLojas(data, colNomeConta, colApelido, colCnpj, colMotivo, colAssunto, colModulo) {
    const container = document.getElementById('page-7-top-lojas');
    if (!container) return;

    // 1. Identificar Top 3 Lojas
    let lojasCount = {};
    let lojasData = {};
    let lojasLabels = {};

    data.forEach(row => {
        const chaveLoja = (row[colNomeConta] || 'Desconhecido').toString().trim();
        if (!lojasCount[chaveLoja]) {
            lojasCount[chaveLoja] = 0;
            lojasData[chaveLoja] = [];
            lojasLabels[chaveLoja] = resolveStoreName(row, colApelido);
        }
        lojasCount[chaveLoja]++;
        lojasData[chaveLoja].push(row);
    });

    let topLojas = Object.entries(lojasCount)
        .sort((a, b) => b[1] - a[1])
        .slice(1, 4) // Pula o 1º colocado (Retaguarda) e pega do 2º ao 4º
        .map(item => item[0]);

    container.innerHTML = '';

    if (topLojas.length === 0) {
        container.innerHTML = '<div style="width: 100%; text-align: center; color: var(--text-muted); margin-top: 50px;">Nenhum dado encontrado para gerar o Top Ofensores.</div>';
        return;
    }

    const totalFiltrado = data.length || 1;
    const accents = ['#00DBFF', '#A44DFF', '#6EEBFF'];
    const escapeHtml = (value) => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    topLojas.forEach((chaveLoja, index) => {
        const loja = lojasLabels[chaveLoja] || 'SEM APELIDO';
        const lojaCasos = lojasData[chaveLoja];
        const totalCasos = lojasCount[chaveLoja];

        // Função auxiliar para agrupar e pegar os top 5
        const getTop5 = (coluna) => {
            if (!coluna) return [];
            let counts = {};
            lojaCasos.forEach(row => {
                const val = (row[coluna] || '').toString().trim();
                if (val) counts[val] = (counts[val] || 0) + 1;
            });
            return Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);
        };

        const assuntos = getTop5(colAssunto);
        const modulos = getTop5(colModulo);
        const motivos = getTop5(colMotivo);

        const renderList = (items) => {
            if (items.length === 0) return '<div class="offender-list-row"><span>Sem dados</span></div>';
            return items.slice(0, 3).map(item => `
                <div class="offender-list-row">
                    <span title="${escapeHtml(item[0])}">${escapeHtml(item[0])}</span>
                    <strong>${item[1]}</strong>
                </div>
            `).join('');
        };

        const maxAssunto = assuntos.length ? assuntos[0][1] : 1;
        const renderTopics = () => assuntos.length ? assuntos.slice(0, 4).map(item => `
            <div class="offender-topic">
                <div class="offender-topic-line">
                    <span title="${escapeHtml(item[0])}">${escapeHtml(item[0])}</span>
                    <strong>${item[1]}</strong>
                </div>
                <div class="offender-topic-track"><i style="width:${Math.max(8, (item[1] / maxAssunto) * 100)}%"></i></div>
            </div>
        `).join('') : '<div class="offender-list-row"><span>Sem assuntos classificados</span></div>';

        const share = ((totalCasos / totalFiltrado) * 100).toFixed(1).replace('.', ',');
        const safeLoja = escapeHtml(loja);

        const cardHtml = `
            <article class="offender-card" style="--offender-accent:${accents[index]}">
                <div class="offender-topline">
                    <span class="offender-rank">0${index + 2} / PRIORIDADE</span>
                    <span class="offender-share">${share}% do volume</span>
                </div>
                <h3 class="offender-name" title="${safeLoja}">${safeLoja}</h3>

                <div class="offender-volume">
                    <strong>${totalCasos}</strong>
                    <span>casos no período</span>
                </div>

                <div class="offender-section">
                    <span class="offender-section-title">Assuntos que concentram demanda</span>
                    ${renderTopics()}
                </div>

                <div class="offender-signals">
                    <div>
                        <span class="offender-section-title">Módulos</span>
                        ${renderList(modulos)}
                    </div>
                    <div>
                        <span class="offender-section-title">Motivos</span>
                        ${renderList(motivos)}
                    </div>
                </div>

                <div class="offender-action">
                    <div class="offender-action-label"><span>Próximo passo</span><span>editável</span></div>
                    <textarea class="action-plan-input" data-store-key="${safeLoja}" aria-label="Plano de ação para ${safeLoja}" placeholder="Responsável, ação e prazo..."></textarea>
                </div>
            </article>
        `;

        container.insertAdjacentHTML('beforeend', cardHtml);
        const planInputs = container.querySelectorAll('.action-plan-input');
        const insertedPlan = planInputs[planInputs.length - 1];
        if (insertedPlan && window.rmrRestoredPlans?.[loja]) insertedPlan.value = window.rmrRestoredPlans[loja];
    });
}

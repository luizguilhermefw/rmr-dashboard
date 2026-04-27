// Globals
let rawDataStore = [];
let charts = {};
let currentSlide = 0;
const slides = document.querySelectorAll('.slide');

// Cores padronizadas para o tema dark premium
const chartColors = {
    red: '#F0462D', // Laranja Linx
    green: '#FFB200', // Amarelo Linx
    blue: '#5D00A5', // Violeta Linx
    purple: '#411E5A', // Roxo (Oxo Linx)
    orange: '#F0462D', // Usando Laranja Linx
    surface: 'rgba(255, 255, 255, 0.05)',
    text: '#A0A0B0',
    grid: 'rgba(255, 255, 255, 0.05)'
};

Chart.defaults.color = chartColors.text;
Chart.defaults.font.family = "'Outfit', sans-serif";

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

// ======= STATE PERSISTENCE (AUTO-RELOAD PARA DESENVOLVIMENTO) =======
function saveStateToSession() {
    try {
        sessionStorage.setItem('rmr_rawDataStore', JSON.stringify(rawDataStore));
        sessionStorage.setItem('rmr_dateRange', document.getElementById('date-range').value);
        sessionStorage.setItem('rmr_selectedClient', document.getElementById('client-select').value);
    } catch (e) {
        console.warn("Não foi possível salvar os dados na sessão (planilha pode ser muito grande).", e);
    }
}

function loadStateFromSession() {
    try {
        const storedData = sessionStorage.getItem('rmr_rawDataStore');
        if (storedData) {
            rawDataStore = JSON.parse(storedData);

            // Re-popula os clientes no dropdown
            const cols = Object.keys(rawDataStore[0]);
            const colNomeConta = cols.find(c => c.toLowerCase().includes('nome da conta') || c.toLowerCase().includes('cnpj')) || cols[0];
            let foundClients = new Set();
            rawDataStore.forEach(row => {
                if (row._masterClientName && row._masterClientName !== "Desconhecido") {
                    foundClients.add(row._masterClientName);
                }
            });

            const clientSelect = document.getElementById('client-select');
            clientSelect.innerHTML = '<option value="TODOS">Todos os Clientes (Visão Global)</option>';
            Array.from(foundClients).sort().forEach(c => {
                clientSelect.innerHTML += `<option value="${c}">${c}</option>`;
            });

            document.getElementById('client-select-container').style.display = 'block';
            document.getElementById('btn-start').style.display = 'inline-flex';
            document.getElementById('upload-status').innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Restauração de sessão ativa (' + rawDataStore.length + ' linhas).';

            const storedDate = sessionStorage.getItem('rmr_dateRange');
            if (storedDate) {
                const fp = document.getElementById('date-range')._flatpickr;
                if (fp) fp.setDate(storedDate.split(" até "));
            }

            const storedClient = sessionStorage.getItem('rmr_selectedClient');
            if (storedClient) clientSelect.value = storedClient;

            const storedSlide = sessionStorage.getItem('rmr_currentSlide');
            // Se havia um painel em andamento, simula o clique no botão e pula para o slide
            if (storedSlide && parseInt(storedSlide) > 0) {
                setTimeout(() => {
                    document.getElementById('btn-start').click(); 
                    setTimeout(() => goToSlide(parseInt(storedSlide)), 50); 
                }, 100);
            }
        }
    } catch (e) {
        console.warn("Não foi possível recuperar os dados da sessão.", e);
    }
}

// ======= SETUP DATEPICKER =======
document.addEventListener('DOMContentLoaded', () => {
    flatpickr("#date-range", {
        mode: "range",
        dateFormat: "d/m/Y",
        locale: "pt",
        altInput: true,
        altFormat: "j M, Y"
    });
    
    loadStateFromSession();
});

// ======= NAVIGATION SCRIPT =======
document.getElementById('btn-start').addEventListener('click', () => {
    try {
        if (rawDataStore.length > 0) {
            saveStateToSession();
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
document.getElementById('btn-export-pdf').addEventListener('click', exportPresentationToPDF);

async function exportPresentationToPDF() {
    const exportButton = document.getElementById('btn-export-pdf');
    const originalLabel = exportButton.innerHTML;

    try {
        exportButton.disabled = true;
        exportButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Exportando...';

        if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
        }

        if (typeof html2canvas === 'undefined') {
            throw new Error('html2canvas não foi carregado.');
        }
        if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
            throw new Error('jsPDF não foi carregado.');
        }

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a4'
        });

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const allSlides = Array.from(document.querySelectorAll('.slide:not(#slide-1)'));

        if (allSlides.length === 0) {
            throw new Error('Não há slides para exportação.');
        }

        for (let i = 0; i < allSlides.length; i++) {
            const clonedSlide = allSlides[i].cloneNode(true);
            const cloneWrapper = document.createElement('div');

            cloneWrapper.style.position = 'fixed';
            cloneWrapper.style.left = '-99999px';
            cloneWrapper.style.top = '0';
            cloneWrapper.style.width = `${window.innerWidth}px`;
            cloneWrapper.style.height = `${window.innerHeight}px`;
            cloneWrapper.style.overflow = 'hidden';
            cloneWrapper.style.zIndex = '-1';
            cloneWrapper.style.background = getComputedStyle(document.body).backgroundColor || '#1E0D2A';

            clonedSlide.style.position = 'relative';
            clonedSlide.style.opacity = '1';
            clonedSlide.style.visibility = 'visible';
            clonedSlide.style.transform = 'none';
            clonedSlide.style.display = 'flex';
            clonedSlide.style.width = '100%';
            clonedSlide.style.height = '100%';
            clonedSlide.style.overflow = 'hidden';

            cloneWrapper.appendChild(clonedSlide);
            document.body.appendChild(cloneWrapper);

            const sourceCanvases = allSlides[i].querySelectorAll('canvas');
            const clonedCanvases = clonedSlide.querySelectorAll('canvas');
            sourceCanvases.forEach((sourceCanvas, canvasIndex) => {
                const targetCanvas = clonedCanvases[canvasIndex];
                if (!targetCanvas) return;

                const sourceDataUrl = sourceCanvas.toDataURL('image/png');
                const sourceImage = new Image();
                sourceImage.src = sourceDataUrl;
                targetCanvas.width = sourceCanvas.width;
                targetCanvas.height = sourceCanvas.height;
                const ctx = targetCanvas.getContext('2d');
                if (ctx) {
                    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
                    ctx.drawImage(sourceImage, 0, 0, targetCanvas.width, targetCanvas.height);
                }
            });

            const canvas = await html2canvas(clonedSlide, {
                backgroundColor: null,
                scale: 2,
                useCORS: true,
                logging: false,
                scrollX: 0,
                scrollY: 0,
                windowWidth: cloneWrapper.clientWidth,
                windowHeight: cloneWrapper.clientHeight
            });

            document.body.removeChild(cloneWrapper);

            const imgData = canvas.toDataURL('image/png', 1.0);
            const imgWidth = canvas.width;
            const imgHeight = canvas.height;
            const scaleRatio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
            const renderWidth = imgWidth * scaleRatio;
            const renderHeight = imgHeight * scaleRatio;
            const marginX = (pdfWidth - renderWidth) / 2;
            const marginY = (pdfHeight - renderHeight) / 2;

            if (i > 0) pdf.addPage('a4', 'landscape');
            pdf.setFillColor(30, 13, 42);
            pdf.rect(0, 0, pdfWidth, pdfHeight, 'F');
            pdf.addImage(imgData, 'PNG', marginX, marginY, renderWidth, renderHeight, undefined, 'FAST');
        }

        pdf.save('apresentacao-rmr.pdf');
    } catch (error) {
        console.error('Erro ao exportar PDF:', error);
        alert('Não foi possível exportar o PDF. Verifique o console para mais detalhes.');
    } finally {
        exportButton.disabled = false;
        exportButton.innerHTML = originalLabel;
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

function updateExportButtonVisibility(currentSlideId) {
    const btn = document.getElementById('btn-export-pdf');
    if (!btn) return;

    if (currentSlideId === 'slide-1') {
        btn.style.display = 'inline-flex';
    } else {
        btn.style.display = 'none';
    }
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
    document.getElementById('slide-counter').textContent = `${currentSlide + 1} / 7`;
    updateExportButtonVisibility(slides[currentSlide]?.id);
    sessionStorage.setItem('rmr_currentSlide', currentSlide);
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

                handleParsedData(jsonResult);
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

function handleParsedData(dataArray) {
    if (dataArray && dataArray.length > 0) {
        // Salesforce costuma colocar rodapés ("Confidential Information").
        // Vamos filtrar as linhas para pegar só as que tem pelo menos 3 colunas com valor
        let validData = dataArray.filter(row => {
            let colunasPreenchidas = Object.values(row).filter(val => val !== null && val.toString().trim() !== "");
            return colunasPreenchidas.length >= 3;
        });

        if (validData.length > 0) {
            rawDataStore = validData;

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
    const dateRangeVal = document.getElementById('date-range').value;
    let startDate = null;
    let endDate = null;

    if (dateRangeVal && dateRangeVal.includes("até")) {
        const parts = dateRangeVal.split("até");

        startDate = parsePtBrDate(parts[0].trim());
        endDate = parsePtBrDate(parts[1].trim());

        // Ajusta final do dia
        if (endDate) {
            endDate.setHours(23, 59, 59, 999);
        }
    }

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

    // 🔹 BASE FILTRADA (Página 2, 4 e 5)
    let dataFiltrada = rawDataStore.filter(row => {
    if (!startDate || !endDate) return true;

    const dataAbertura = parsePtBrDate(row[colAbertura]);
    if (!dataAbertura) return false;

    return dataAbertura >= startDate && dataAbertura <= endDate;
});

    // 🔹 BASE COMPLETA (Página 3)
    let dataCompleta = rawDataStore;
    const selectedClientEl = document.getElementById('client-select');
    const selectedClient = selectedClientEl ? selectedClientEl.value : "TODOS";

    if (selectedClient && selectedClient !== "TODOS") {
        dataFiltrada = dataFiltrada.filter(row => row._masterClientName === selectedClient);
        dataCompleta = dataCompleta.filter(row => row._masterClientName === selectedClient);

        document.getElementById('client-name').textContent = "RMR - " + selectedClient.toUpperCase();
    }

    if (dataFiltrada.length === 0) {
        alert("Atenção: Não foram encontrados casos para o filtro de cliente e datas atual no arquivo lido.");
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
            
            const conta = row[colNomeConta];
            const identificadorConta = (colCnpj && row[colCnpj]) ? row[colCnpj] : conta;
            if (identificadorConta) {
                monthlyData[monthKey].contas.add(identificadorConta);
                monthlyData[monthKey].contasMap[identificadorConta] = (monthlyData[monthKey].contasMap[identificadorConta] || 0) + 1;

                if (!accountDetailsMap[identificadorConta]) {
                    accountDetailsMap[identificadorConta] = {
                        rede: (colRede && row[colRede]) ? row[colRede] : (row._masterClientName !== 'Desconhecido' ? row._masterClientName : '-'),
                        apelido: conta
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
    let pbColor = '#F0462D'; // Laranja Linx para dar destaque

    document.getElementById('sla-value').textContent = `${percSLA}%`;

    renderGauge(percSLA, pbColor);
    renderComparative(monthlyData, accountDetailsMap);

    // Extrai dados e renderiza a Página 4: Volumetria Geral
    renderVolumetria(dataFiltrada, colNomeConta, colTipo, colIdade, colCnpj, colRede);
    renderAnalisePagina6(dataFiltrada, colModulo, colMotivo, colAssunto, colTipo);
    renderAnalisePagina6(dataFiltrada, colModulo, colMotivo, colAssuntoEncerramento || colAssunto, colTipo);

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
        ctx.font = fontSize + "px 'Outfit', sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";

        var text = chart.data.datasets[0].data[0].toString().replace('.', ',') + "%",
            textX = Math.round((width - ctx.measureText(text).width) / 2),
            textY = height - (height * 0.15); // near bottom

        ctx.fillText(text, textX, textY);

        ctx.font = "16px 'Outfit', sans-serif";
        ctx.fontWeight = "bold";
        ctx.fillStyle = "#A0A0B0";
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
                backgroundColor: [color, '#e2e2e2'],
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

function formatMonth(yyyy_mm) {
    if (!yyyy_mm || yyyy_mm === 'Desconhecido') return yyyy_mm;
    const parts = yyyy_mm.split('-');
    if (parts.length < 2) return yyyy_mm;
    const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
    let str = date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    return str.charAt(0).toUpperCase() + str.slice(1);
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

    // Inicialização do Array
    let defaultBase = '';
    let defaultComp = '';

    if (months.length > 0) {
        defaultBase = months[0];
        defaultComp = months.length > 1 ? months[1] : months[0];
    } else {
        const d = new Date();
        const y = d.getFullYear();
        const m = (d.getMonth() + 1).toString().padStart(2, '0');
        defaultBase = `${y}-${m}`;
        defaultComp = `${y}-${m}`;
    }

    selBase.value = defaultBase;
    selComp.value = defaultComp;

    // Configuração do Plugin MonthSelect
    const flatpickrConfig = {
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
    };

    flatpickr(selBase, flatpickrConfig);
    flatpickr(selComp, flatpickrConfig);
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
    document.getElementById('diff-cnpj-qtd').style.color = diffCnpjQtd > 0 ? '#F0462D' : (diffCnpjQtd < 0 ? '#FFB200' : 'white');
    document.getElementById('diff-cnpj-perc').style.color = diffCnpjQtd > 0 ? '#F0462D' : (diffCnpjQtd < 0 ? '#FFB200' : 'white');
    document.getElementById('diff-caso-qtd').style.color = diffCasoQtd > 0 ? '#F0462D' : (diffCasoQtd < 0 ? '#FFB200' : 'white');
    document.getElementById('diff-caso-perc').style.color = diffCasoQtd > 0 ? '#F0462D' : (diffCasoQtd < 0 ? '#FFB200' : 'white');

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
        let diffColor = item.diff > 0 ? '#F0462D' : (item.diff < 0 ? '#22c55e' : 'var(--text-muted)');
        let diffText = item.diff > 0 ? '+' + item.diff : item.diff;

        let detalhes = globalAccountDetailsMap[item.nome] || { rede: '-', apelido: item.nome };

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

    let totalTableDiffColor = totalTableDiff > 0 ? '#F0462D' : (totalTableDiff < 0 ? '#22c55e' : 'white');
    let totalTableDiffText = totalTableDiff > 0 ? '+' + totalTableDiff : totalTableDiff;

    document.getElementById('table-total-diff').textContent = totalTableDiffText;
    document.getElementById('table-total-diff').style.color = totalTableDiffColor;
    document.getElementById('table-total-casos').textContent = totalTableCasos;

    // ================= NOVA LÓGICA (REDES) =================
    let redeStats = {};

    allKeys.forEach(cnpj => {
        const baseCount = dataBase.contasMap[cnpj] || 0;
        const compCount = dataComp.contasMap[cnpj] || 0;
        const detalhes = globalAccountDetailsMap[cnpj] || { rede: '-', apelido: cnpj };
        // Agrupa por Rede. Se a conta não tiver Rede mapeada, usa o Nome/Apelido como Rede.
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
        let diffColor = item.diff > 0 ? '#F0462D' : (item.diff < 0 ? '#22c55e' : 'var(--text-muted)');
        let diffText = item.diff > 0 ? '+' + item.diff : item.diff;

        redeHtml += `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                <td style="padding: 12px 8px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;" title="${item.rede}">${item.rede}</td>
                <td style="padding: 12px 8px; text-align: center;">${item.comp}</td>
                <td style="padding: 12px 8px; text-align: center;">${item.base}</td>
                <td style="padding: 12px 8px; text-align: center; color: ${diffColor}; font-weight: bold;">${diffText}</td>
            </tr>
        `;
    });

    if (redeArray.length === 0) {
        redeHtml = `<tr><td colspan="4" style="padding: 20px; text-align: center; color: var(--text-muted);">Nenhuma Rede com chamados no período</td></tr>`;
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
                        backgroundColor: 'rgba(255, 255, 255, 0.2)', // Branco Transparente (fundo)
                        borderRadius: 4
                    },
                    {
                        label: baseLabel + ' (Base)',
                        data: topRedes.map(r => r.base),
                        backgroundColor: '#F0462D', // Laranja Linx (destaque)
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
                        labels: { color: '#A0A0B0', font: { family: "'Outfit', sans-serif" } }
                    },
                    tooltip: {
                        backgroundColor: '#411E5A',
                        titleFont: { family: "'Outfit', sans-serif", size: 14 },
                        bodyFont: { family: "'Outfit', sans-serif", size: 14 }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false, drawBorder: false },
                        ticks: { color: '#A0A0B0', font: { family: "'Outfit', sans-serif" } }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                        ticks: { color: '#A0A0B0', font: { family: "'Outfit', sans-serif" } }
                    }
                }
            }
        });
    }
}

// ======= VOLUMETRIA GERAL (PAGE 4) =======
function renderVolumetria(data, colNomeConta, colTipo, colIdade, colCnpj, colRede) {
    let marcasMap = {};
    let tiposCount = { 'Dúvida': 0, 'Incidente': 0, 'Requisição': 0, 'Serviço': 0, 'Manutenção': 0, 'Outros': 0 };

    let sumIdadeResolvidos = 0;
    let countResolvidos = 0;

    data.forEach(row => {
        // 1. Marca/Loja Aggregation
        const marcaRaw = row[colNomeConta] || 'Desconhecido';
        const marca = marcaRaw.toString().toUpperCase().trim();

        if (!marcasMap[marca]) {
            marcasMap[marca] = { 
                rede: (colRede && row[colRede]) ? row[colRede] : (row._masterClientName !== 'Desconhecido' ? row._masterClientName : '-'),
                apelido: marcaRaw,
                total: 0, 
                abertos: 0, 
                fechados: 0, 
                cnpjs: new Set() 
            };
        }

        let mObj = marcasMap[marca];
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
    // Calculate 'tempo filtrado' in days
    // We will extract all valid dates found in the data to determine how many unique days of operation exist in the imported file
    let uniqueDays = new Set();
    data.forEach(row => {
        // Look for values that resemble dates (e.g. DD/MM/YYYY)
        let rowStr = Object.values(row).join(' ');
        let match = rowStr.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
        if (match) {
            uniqueDays.add(match[1]);
        }
    });

    // The total time span is the count of unique days observed
    // This answers "qual a densidade de contato para uma loja que em 60 dias abriu 60 casos?" -> 1 case per day
    let tempoFiltrado = uniqueDays.size > 0 ? uniqueDays.size : 1; // Default to 1 to avoid division by zero

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
                <td style="padding: 10px 5px; text-align: center; color: ${m.abertos > 0 ? '#F0462D' : 'inherit'};">${m.abertos}</td>
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
                backgroundColor: '#FFB200', // Amarelo Linx
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
                    backgroundColor: '#411E5A',
                    titleFont: { family: "'Outfit', sans-serif", size: 14 },
                    bodyFont: { family: "'Outfit', sans-serif", size: 14 }
                }
            },
            scales: {
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: { color: '#A0A0B0', font: { family: "'Outfit', sans-serif" } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                    ticks: { color: '#A0A0B0', font: { family: "'Outfit', sans-serif" } }
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
                    backgroundColor: chartColors.blue, // Violeta Linx
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
                    backgroundColor: [chartColors.green, chartColors.orange, chartColors.blue, '#22c55e', '#8b5cf6', '#f43f5e'],
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

        const insightEl = document.getElementById('assunto-insight');
        if (insightEl) {
            if (labelsAssunto.length > 0) {
                const topAssunto = labelsAssunto[0];
                const topQtd = dataAssunto[0];
                insightEl.innerHTML = `🔎 Principal dor: <b>${topAssunto}</b> (${topQtd} casos)`;
                insightEl.style.display = 'block';
            } else {
                insightEl.style.display = 'none';
            }
        }

        const ctxAssuntos = document.getElementById('chartAssuntos').getContext('2d');
        if (charts.assuntos) charts.assuntos.destroy();

        charts.assuntos = new Chart(ctxAssuntos, {
            type: 'bar',
            data: {
                labels: labelsAssunto,
                datasets: [{
                    label: 'Ocorrências',
                    data: dataAssunto,
                    backgroundColor: dataAssunto.map((_, index) => index === 0 ? '#FF3B3B' : chartColors.red),
                    borderRadius: 4,
                    barPercentage: 0.9
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: {
                        left: 10
                    }
                },
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
                    y: {
                        grid: { display: false },
                        ticks: {
                            color: chartColors.text,
                            font: { size: 13, weight: 'bold' },
                            autoSkip: false,
                            callback: function (value) {
                                let label = this.getLabelForValue(value) || '';
                                return label.length > 35 ? label.substring(0, 35) + '...' : label;
                            }
                        }
                    }
                }
            }
        });
    }
}

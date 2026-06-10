document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide icons
    lucide.createIcons();

    // ================================================================
    // DOM References
    // ================================================================
    const refreshBtn = document.getElementById('refresh-btn');
    const refreshIcon = document.querySelector('.refresh-icon');
    const liveRegion = document.getElementById('live-region');

    // KPI Elements
    const totalCountEl = document.getElementById('total-count');
    const unassignedCountEl = document.getElementById('unassigned-count');
    const mineCountEl = document.getElementById('mine-count');
    const rateValueEl = document.getElementById('rate-value');

    // KPI Cards
    const kpiTotal = document.getElementById('kpi-total');
    const kpiUnassigned = document.getElementById('kpi-unassigned');
    const kpiMine = document.getElementById('kpi-mine');
    const kpiRate = document.getElementById('kpi-rate');

    // Chart Cards
    const assignmentChartCard = document.getElementById('assignment-chart-card');
    const labelsChartCard = document.getElementById('labels-chart-card');

    // Labels
    const labelsContainer = document.getElementById('labels-container');
    const labelsBadge = document.getElementById('labels-total-badge');

    // Status
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const lastUpdateEl = document.getElementById('last-update');

    // Auto-Refresh
    const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
    const autoRefreshLabel = document.getElementById('auto-refresh-label');
    const refreshProgress = document.getElementById('refresh-progress');

    // Toast
    const toastContainer = document.getElementById('toast-container');

    // ================================================================
    // State
    // ================================================================
    let assignmentChartInstance = null;
    let labelsChartInstance = null;
    let autoRefreshEnabled = true;
    let autoRefreshInterval = null;
    let autoRefreshTimer = null;
    const AUTO_REFRESH_SECONDS = 60;
    let refreshCountdown = AUTO_REFRESH_SECONDS;

    // Chart.js color palette (violet-based)
    const chartPalette = [
        '#8b5cf6', '#6366f1', '#a78bfa', '#818cf8',
        '#c4b5fd', '#7c3aed', '#6d28d9', '#ddd6fe',
        '#34d399', '#22d3ee', '#fbbf24', '#fb7185'
    ];

    // ================================================================
    // Animated Count-Up
    // ================================================================
    function animateCount(element, target, duration = 800, suffix = '') {
        const start = parseInt(element.textContent) || 0;
        const range = target - start;
        if (range === 0) {
            element.innerHTML = target + suffix;
            return;
        }

        const startTime = performance.now();

        function step(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.round(start + range * eased);
            element.innerHTML = current + suffix;

            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                element.innerHTML = target + suffix;
                element.classList.add('count-pulse');
                setTimeout(() => element.classList.remove('count-pulse'), 400);
            }
        }

        requestAnimationFrame(step);
    }

    // ================================================================
    // Toast Notification System
    // ================================================================
    function showToast(message, type = 'info', duration = 4000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const iconMap = {
            success: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
            error: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            info: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
        };

        toast.innerHTML = `${iconMap[type] || iconMap.info}<span>${message}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-out');
            toast.addEventListener('animationend', () => toast.remove());
        }, duration);
    }

    // ================================================================
    // Status Indicator
    // ================================================================
    function setStatus(online) {
        if (online) {
            statusDot.classList.remove('offline');
            statusText.textContent = 'Conectado';
        } else {
            statusDot.classList.add('offline');
            statusText.textContent = 'Offline';
        }
    }

    function updateLastRefresh() {
        const now = new Date();
        const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        lastUpdateEl.textContent = `Atualizado às ${time}`;
    }

    // ================================================================
    // Auto-Refresh System
    // ================================================================
    const circumference = 2 * Math.PI * 10; // r=10 from SVG

    function startAutoRefresh() {
        stopAutoRefresh();
        autoRefreshEnabled = true;
        autoRefreshToggle.classList.add('active');
        autoRefreshLabel.textContent = `Auto ${AUTO_REFRESH_SECONDS}s`;
        refreshCountdown = AUTO_REFRESH_SECONDS;

        autoRefreshTimer = setInterval(() => {
            refreshCountdown--;
            // Update circular progress
            const offset = circumference * (1 - refreshCountdown / AUTO_REFRESH_SECONDS);
            refreshProgress.style.strokeDashoffset = offset;

            if (refreshCountdown <= 0) {
                fetchMetrics(true); // silent = true
                refreshCountdown = AUTO_REFRESH_SECONDS;
            }
        }, 1000);
    }

    function stopAutoRefresh() {
        autoRefreshEnabled = false;
        autoRefreshToggle.classList.remove('active');
        autoRefreshLabel.textContent = 'Auto off';
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
        }
        refreshProgress.style.strokeDashoffset = 0;
    }

    function toggleAutoRefresh() {
        if (autoRefreshEnabled) {
            stopAutoRefresh();
            showToast('Auto-refresh desativado', 'info', 2000);
        } else {
            startAutoRefresh();
            showToast('Auto-refresh ativado (60s)', 'info', 2000);
        }
    }

    autoRefreshToggle.addEventListener('click', toggleAutoRefresh);
    autoRefreshToggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleAutoRefresh();
        }
    });

    // ================================================================
    // Staggered Card Animation
    // ================================================================
    function animateCardsIn() {
        const cards = document.querySelectorAll('.card:not(.skeleton)');
        cards.forEach((card, i) => {
            card.classList.remove('animate-in');
            // Force reflow
            void card.offsetWidth;
            card.classList.add('animate-in', `stagger-${Math.min(i + 1, 8)}`);
        });
    }

    // ================================================================
    // Fetch Metrics
    // ================================================================
    const fetchMetrics = async (silent = false) => {
        // Set loading states
        refreshIcon.classList.add('spin');
        refreshBtn.classList.remove('btn-breathe');
        refreshBtn.setAttribute('aria-disabled', 'true');

        if (!silent) {
            kpiTotal.classList.add('skeleton');
            kpiUnassigned.classList.add('skeleton');
            kpiMine.classList.add('skeleton');
            kpiRate.classList.add('skeleton');
            assignmentChartCard.classList.add('skeleton');
            labelsChartCard.classList.add('skeleton');
        }

        liveRegion.textContent = 'Carregando métricas…';

        try {
            const response = await fetch('/api/metrics');
            if (!response.ok) throw new Error('Failed to fetch');

            const data = await response.json();
            setStatus(true);

            // Remove skeletons
            [kpiTotal, kpiUnassigned, kpiMine, kpiRate, assignmentChartCard, labelsChartCard]
                .forEach(el => el.classList.remove('skeleton'));

            // Animate KPI values
            animateCount(totalCountEl, data.totalConversations, 1000);
            animateCount(unassignedCountEl, data.unassignedCount, 800);
            animateCount(mineCountEl, data.mineCount, 800);

            // Calculate attribution rate
            const rate = data.totalConversations > 0
                ? Math.round(((data.totalConversations - data.unassignedCount) / data.totalConversations) * 100)
                : 0;
            animateCount(rateValueEl, rate, 800, '<span class="metric-suffix">%</span>');

            // Sort labels by count descending
            const sortedLabels = data.labels.sort((a, b) => b.count - a.count);

            // Update badge
            labelsBadge.textContent = `${sortedLabels.length} etiquetas`;

            // Render label cards
            labelsContainer.innerHTML = '';

            if (sortedLabels.length === 0) {
                labelsContainer.innerHTML = '<p style="color: var(--text-muted); padding: var(--space-3);">Nenhuma etiqueta encontrada.</p>';
            } else {
                sortedLabels.forEach((label, index) => {
                    const card = document.createElement('div');
                    card.className = 'card label-card animate-in stagger-' + Math.min(index + 1, 8);
                    card.style.setProperty('--label-color', label.color || '#8b5cf6');

                    card.innerHTML = `
                        <div class="label-header">
                            <div class="label-title-wrapper">
                                <span class="color-dot" style="background-color: ${escapeHTML(label.color) || '#8b5cf6'}; --dot-glow: ${escapeHTML(label.color) || '#8b5cf6'}40;" aria-hidden="true"></span>
                                <span class="label-title">${escapeHTML(label.title)}</span>
                            </div>
                            <div class="label-count" aria-label="${label.count} conversas">${label.count}</div>
                        </div>
                        ${label.description ? `<p class="label-desc">${escapeHTML(label.description)}</p>` : ''}
                    `;
                    labelsContainer.appendChild(card);
                });
            }

            // Render Charts
            renderCharts(data);

            // Animate cards in
            animateCardsIn();

            // Update timestamp
            updateLastRefresh();

            // Reset auto-refresh countdown
            if (autoRefreshEnabled) {
                refreshCountdown = AUTO_REFRESH_SECONDS;
                refreshProgress.style.strokeDashoffset = 0;
            }

            liveRegion.textContent = `Métricas atualizadas. Total de ${data.totalConversations} conversas.`;

            if (!silent) {
                showToast('Métricas atualizadas com sucesso', 'success', 3000);
            }

        } catch (error) {
            console.error('Error:', error);
            setStatus(false);
            liveRegion.textContent = 'Erro ao carregar as métricas.';

            [kpiTotal, kpiUnassigned, kpiMine, kpiRate, assignmentChartCard, labelsChartCard]
                .forEach(el => el.classList.remove('skeleton'));

            totalCountEl.textContent = '—';
            unassignedCountEl.textContent = '—';
            mineCountEl.textContent = '—';
            rateValueEl.innerHTML = '—<span class="metric-suffix">%</span>';
            labelsContainer.innerHTML = '<p style="color: var(--text-muted); padding: var(--space-3);">Erro ao carregar as etiquetas.</p>';

            showToast('Falha ao carregar métricas', 'error', 5000);
        } finally {
            refreshIcon.classList.remove('spin');
            refreshBtn.classList.add('btn-breathe');
            refreshBtn.removeAttribute('aria-disabled');
        }
    };

    // ================================================================
    // XSS Prevention
    // ================================================================
    function escapeHTML(str) {
        if (!str) return '';
        return str.replace(/[&<>'"]/g,
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }

    // ================================================================
    // Chart Rendering
    // ================================================================
    function renderCharts(data) {
        // Chart.js defaults for dark theme
        Chart.defaults.color = '#a5a1b7';
        Chart.defaults.font.family = "'Outfit', sans-serif";
        Chart.defaults.font.size = 12;
        Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(22, 20, 38, 0.95)';
        Chart.defaults.plugins.tooltip.titleColor = '#f1f0f7';
        Chart.defaults.plugins.tooltip.bodyColor = '#f1f0f7';
        Chart.defaults.plugins.tooltip.padding = 14;
        Chart.defaults.plugins.tooltip.cornerRadius = 10;
        Chart.defaults.plugins.tooltip.displayColors = true;
        Chart.defaults.plugins.tooltip.borderColor = 'rgba(139,92,246,0.2)';
        Chart.defaults.plugins.tooltip.borderWidth = 1;

        // —— 1. Doughnut Chart ——
        const ctxAssignment = document.getElementById('assignmentChart').getContext('2d');
        if (assignmentChartInstance) assignmentChartInstance.destroy();

        const doughnutLabels = data.labels.map(l => l.title);
        const doughnutData = data.labels.map(l => l.count);
        const doughnutColors = data.labels.map((l, i) => l.color || chartPalette[i % chartPalette.length]);

        assignmentChartInstance = new Chart(ctxAssignment, {
            type: 'doughnut',
            data: {
                labels: doughnutLabels,
                datasets: [{
                    data: doughnutData,
                    backgroundColor: doughnutColors,
                    borderWidth: 0,
                    hoverOffset: 10,
                    spacing: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '72%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 16,
                            usePointStyle: true,
                            pointStyleWidth: 10,
                            font: { size: 12, family: "'Outfit', sans-serif" }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const pct = total > 0 ? Math.round((context.parsed / total) * 100) : 0;
                                return `${context.label}: ${context.parsed} (${pct}%)`;
                            }
                        }
                    }
                },
                animation: {
                    animateScale: true,
                    animateRotate: true,
                    duration: 1200,
                    easing: 'easeOutQuart'
                }
            }
        });

        // —— 2. Horizontal Bar Chart ——
        const ctxLabels = document.getElementById('labelsChart').getContext('2d');
        if (labelsChartInstance) labelsChartInstance.destroy();

        const sortedLabels = [...data.labels].sort((a, b) => b.count - a.count);

        labelsChartInstance = new Chart(ctxLabels, {
            type: 'bar',
            data: {
                labels: sortedLabels.map(l => l.title),
                datasets: [{
                    label: 'Conversas',
                    data: sortedLabels.map(l => l.count),
                    backgroundColor: sortedLabels.map((l, i) => {
                        const color = l.color || chartPalette[i % chartPalette.length];
                        return color + 'cc'; // slight transparency
                    }),
                    borderColor: sortedLabels.map((l, i) => l.color || chartPalette[i % chartPalette.length]),
                    borderWidth: 1,
                    borderRadius: 6,
                    barPercentage: 0.65,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `${context.parsed.x} conversas`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(139,92,246,0.06)',
                            drawBorder: false
                        },
                        beginAtZero: true,
                        ticks: { precision: 0 }
                    },
                    y: {
                        grid: { display: false },
                        ticks: {
                            font: { size: 12, weight: 500 }
                        }
                    }
                },
                animation: {
                    duration: 1000,
                    easing: 'easeOutQuart'
                }
            }
        });
    }

    // ================================================================
    // Event Listeners
    // ================================================================
    refreshBtn.addEventListener('click', () => {
        if (refreshBtn.getAttribute('aria-disabled') !== 'true') {
            fetchMetrics(false);
        }
    });

    // ================================================================
    // Init
    // ================================================================
    fetchMetrics(false);
    startAutoRefresh();
});

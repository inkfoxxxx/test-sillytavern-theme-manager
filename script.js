(function () {
    'must use';

    const initInterval = setInterval(() => {
        const originalSelect = document.querySelector('#themes');
        const updateButton = document.querySelector('#ui-preset-update-button');
        const saveAsButton = document.querySelector('#ui-preset-save-button');

        if (originalSelect && updateButton && saveAsButton && window.SillyTavern?.getContext && !document.querySelector('#theme-manager-panel')) {
            console.log("Theme Manager (v21.1 Final Fix): 初始化...");
            clearInterval(initInterval);

            try {
                // 【核心修改】移除了 reloadThemes，因为它导致了问题
                const { getRequestHeaders, showLoader, hideLoader } = SillyTavern.getContext();
                const FAVORITES_KEY = 'themeManager_favorites';
                const COLLAPSE_KEY = 'themeManager_collapsed';

                let openCategoriesAfterRefresh = new Set();
                let allParsedThemes = [];
                let refreshNeeded = false; // 【核心修改】用于追踪是否需要刷新的状态旗帜

                async function apiRequest(endpoint, method = 'POST', body = {}) {
                    try {
                        const headers = getRequestHeaders();
                        const options = { method, headers };
                        if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
                            options.body = JSON.stringify(body);
                        }
                        const response = await fetch(`/api/${endpoint}`, options);
                        const responseText = await response.text();
                        if (!response.ok) {
                            try { const errorData = JSON.parse(responseText); throw new Error(errorData.error || `HTTP error! status: ${response.status}`); }
                            catch (e) { throw new Error(responseText || `HTTP error! status: ${response.status}`); }
                        }
                        if (responseText.trim().toUpperCase() === 'OK') return { status: 'OK' };
                        return responseText ? JSON.parse(responseText) : {};
                    } catch (error) {
                        console.error(`API request to /api/${endpoint} failed:`, error);
                        toastr.error(`API请求失败: ${error.message}`);
                        throw error;
                    }
                }
                async function getAllThemesFromAPI() { return (await apiRequest('settings/get', 'POST', {})).themes || []; }
                async function deleteTheme(themeName) { await apiRequest('themes/delete', 'POST', { name: themeName }); }
                async function saveTheme(themeObject) { await apiRequest('themes/save', 'POST', themeObject); }
                function manualUpdateOriginalSelect(action, oldName, newName) {
                    const originalSelect = document.querySelector('#themes');
                    if (!originalSelect) return;
                    if (action === 'add') {
                        const option = document.createElement('option');
                        option.value = newName; option.textContent = newName;
                        originalSelect.appendChild(option);
                    } else if (action === 'delete') {
                        const optionToDelete = originalSelect.querySelector(`option[value="${oldName}"]`);
                        if (optionToDelete) optionToDelete.remove();
                    } else if (action === 'rename') {
                        const optionToRename = originalSelect.querySelector(`option[value="${oldName}"]`);
                        if (optionToRename) { optionToRename.value = newName; optionToRename.textContent = newName; }
                    }
                }
                
                function getTagsFromThemeName(themeName) {
                    const tags = [];
                    const tagRegex = /\[(.*?)\]/g;
                    let match;
                    while ((match = tagRegex.exec(themeName)) !== null) {
                        if (match[1].trim()) tags.push(match[1].trim());
                    }
                    if (tags.length === 0) tags.push('未分类');
                    return tags;
                }

                function getCategoriesForThemes(themeNamesSet) {
                    const categories = new Set();
                    themeNamesSet.forEach(themeName => {
                        const theme = allParsedThemes.find(t => t.value === themeName);
                        if (theme) {
                            theme.tags.forEach(tag => categories.add(tag));
                        }
                    });
                    return categories;
                }

                const originalContainer = originalSelect.parentElement;
                if (!originalContainer) return;
                originalSelect.style.display = 'none';

                const managerPanel = document.createElement('div');
                managerPanel.id = 'theme-manager-panel';
                managerPanel.innerHTML = `
                    <div id="theme-manager-header">
                        <h4>🎨 主题美化管理</h4>
                        <div id="native-buttons-container"></div>
                        <div id="theme-manager-toggle-icon" class="fa-solid fa-chevron-down"></div>
                    </div>
                    <div id="theme-manager-content">
                        <div class="theme-manager-actions">
                            <input type="search" id="theme-search-box" placeholder="🔍 搜索主题...">
                            <button id="random-theme-btn" title="随机应用一个主题">🎲 随机</button>
                            <button id="batch-edit-btn" title="进入/退出批量编辑模式">🔧 批量编辑</button>
                            <button id="batch-import-btn" title="从文件批量导入主题">📂 批量导入</button>
                        </div>
                        <!-- 【核心修改】添加刷新提示区域 -->
                        <div id="theme-manager-refresh-notice" style="display:none; margin:10px 0; padding: 8px; background-color: rgba(255, 165, 0, 0.2); border: 1px solid orange; border-radius: 4px; text-align: center;">
                            💡 <b>提示：</b>检测到主题文件变更。为确保所有更改完全生效，请在完成所有操作后
                            <button id="theme-manager-refresh-page-btn" style="border:none; background:none; color:var(--primary-color, #007bff); text-decoration:underline; cursor:pointer; padding:0 5px;">刷新页面</button>。
                        </div>
                        <div id="batch-actions-bar">
                            <button id="batch-add-tag-btn">➕ 添加标签</button>
                            <button id="batch-move-tag-btn">➡️ 移动到分类</button>
                            <button id="batch-delete-tag-btn">❌ 移除标签</button>
                            <button id="batch-dissolve-btn">🗂️ 解散选中文件夹</button> 
                            <button id="batch-delete-btn">🗑️ 删除选中</button>
                        </div>
                        <div class="theme-content"></div>
                    </div>`;
                originalContainer.prepend(managerPanel);

                const nativeButtonsContainer = managerPanel.querySelector('#native-buttons-container');
                nativeButtonsContainer.appendChild(updateButton);
                nativeButtonsContainer.appendChild(saveAsButton);

                const header = managerPanel.querySelector('#theme-manager-header');
                const content = managerPanel.querySelector('#theme-manager-content');
                const toggleIcon = managerPanel.querySelector('#theme-manager-toggle-icon');
                const batchEditBtn = managerPanel.querySelector('#batch-edit-btn');
                const batchActionsBar = managerPanel.querySelector('#batch-actions-bar');
                const contentWrapper = managerPanel.querySelector('.theme-content');
                const searchBox = managerPanel.querySelector('#theme-search-box');
                const randomBtn = managerPanel.querySelector('#random-theme-btn');
                const batchImportBtn = managerPanel.querySelector('#batch-import-btn');
                
                // 【核心修改】获取提示元素并绑定事件
                const refreshNotice = managerPanel.querySelector('#theme-manager-refresh-notice');
                const refreshBtn = managerPanel.querySelector('#theme-manager-refresh-page-btn');
                refreshBtn.addEventListener('click', () => location.reload());

                // 【核心修改】显示刷新提示的函数
                function showRefreshNotification() {
                    if (!refreshNeeded) {
                        refreshNeeded = true;
                        refreshNotice.style.display = 'block';
                    }
                }

                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.multiple = true;
                fileInput.accept = '.json';
                fileInput.style.display = 'none';
                document.body.appendChild(fileInput);

                let favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
                let allThemeObjects = [];
                let isBatchEditMode = false;
                let selectedForBatch = new Set();
                let selectedFoldersForBatch = new Set();

                function setCollapsed(isCollapsed, animate = false) {
                    if (isCollapsed) {
                        if (animate) {
                            content.style.maxHeight = content.scrollHeight + 'px';
                            requestAnimationFrame(() => {
                                content.style.maxHeight = '0px';
                                content.style.paddingTop = '0px';
                                content.style.paddingBottom = '0px';
                            });
                        } else {
                            content.style.maxHeight = '0px';
                            content.style.paddingTop = '0px';
                            content.style.paddingBottom = '0px';
                        }
                        toggleIcon.classList.add('collapsed');
                        localStorage.setItem(COLLAPSE_KEY, 'true');
                    } else {
                        content.style.paddingTop = '';
                        content.style.paddingBottom = '';
                        if (animate) {
                            content.style.maxHeight = content.scrollHeight + 'px';
                            setTimeout(() => { content.style.maxHeight = ''; }, 300);
                        } else {
                            content.style.maxHeight = '';
                        }
                        toggleIcon.classList.remove('collapsed');
                        localStorage.setItem(COLLAPSE_KEY, 'false');
                    }
                }

                async function buildThemeUI() {
                    const scrollTop = contentWrapper.scrollTop;
                    contentWrapper.innerHTML = '正在加载主题...';
                    try {
                        allThemeObjects = await getAllThemesFromAPI();
                        contentWrapper.innerHTML = '';

                        allParsedThemes = Array.from(originalSelect.options).map(option => {
                            const themeName = option.value;
                            if (!themeName) return null;
                            const tags = getTagsFromThemeName(themeName);
                            const displayName = themeName.replace(/\[.*?\]/g, '').trim() || themeName;
                            return { value: themeName, display: displayName, tags: tags };
                        }).filter(Boolean);

                        const allCategories = new Set(allParsedThemes.flatMap(t => t.tags));
                        const sortedCategories = ['⭐ 收藏夹', ...Array.from(allCategories).sort((a, b) => a.localeCompare(b, 'zh-CN'))];

                        sortedCategories.forEach(category => {
                            const themesInCategory = (category === '⭐ 收藏夹') ? allParsedThemes.filter(t => favorites.includes(t.value)) : allParsedThemes.filter(t => t.tags.includes(category));
                            if (themesInCategory.length === 0 && category !== '未分类' && category !== '⭐ 收藏夹') return;

                            const categoryDiv = document.createElement('div');
                            categoryDiv.className = 'theme-category';
                            categoryDiv.dataset.categoryName = category;
                            const title = document.createElement('div');
                            title.className = 'theme-category-title';
                            
                            let titleHTML = '';
                            if (category !== '未分类' && category !== '⭐ 收藏夹') {
                                titleHTML += `<input type="checkbox" class="folder-select-checkbox" title="选择文件夹进行批量操作">`;
                            }
                            titleHTML += `<span>${category}</span>`;
                            if (category !== '未分类' && category !== '⭐ 收藏夹') {
                                titleHTML += `<button class="dissolve-folder-btn" title="解散此文件夹">解散</button>`;
                            }
                            title.innerHTML = titleHTML;

                            const list = document.createElement('ul');
                            list.className = 'theme-list';
                            
                            if (openCategoriesAfterRefresh.size > 0 && !openCategoriesAfterRefresh.has(category)) {
                                list.style.display = 'none';
                            } else {
                                list.style.display = 'block';
                            }

                            themesInCategory.forEach(theme => {
                                const item = document.createElement('li');
                                item.className = 'theme-item';
                                item.dataset.value = theme.value;
                                const isFavorited = favorites.includes(theme.value);
                                const starCharacter = isFavorited ? '★' : '☆';
                                item.innerHTML = `
                                    <span class="theme-item-name">${theme.display}</span>
                                    <div class="theme-item-buttons">
                                        <button class="favorite-btn" title="收藏">${starCharacter}</button>
                                        <button class="rename-btn" title="重命名">✏️</button>
                                        <button class="delete-btn" title="删除">🗑️</button>
                                    </div>`;
                                list.appendChild(item);
                            });

                            categoryDiv.appendChild(title);
                            categoryDiv.appendChild(list);
                            contentWrapper.appendChild(categoryDiv);
                        });
                        
                        contentWrapper.scrollTop = scrollTop;
                        updateActiveState();
                        openCategoriesAfterRefresh.clear();

                    } catch (err) {
                        contentWrapper.innerHTML = '加载主题失败，请检查浏览器控制台获取更多信息。';
                        openCategoriesAfterRefresh.clear();
                    }
                }

                function updateActiveState() {
                    const currentValue = originalSelect.value;
                    managerPanel.querySelectorAll('.theme-item').forEach(item => {
                        item.classList.toggle('active', item.dataset.value === currentValue);
                    });
                }

                async function performBatchRename(renameLogic) {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    showLoader();
                    
                    let successCount = 0;
                    let errorCount = 0;
                    let skippedCount = 0;
                    const currentThemes = await getAllThemesFromAPI();

                    for (const oldName of selectedForBatch) {
                        try {
                            const themeObject = currentThemes.find(t => t.name === oldName);
                            if (!themeObject) {
                                console.warn(`批量操作：在API返回中未找到主题 "${oldName}"，已跳过。`);
                                skippedCount++;
                                continue;
                            }
                            const newName = renameLogic(oldName);
                            if (currentThemes.some(t => t.name === newName && t.name !== oldName)) {
                                console.warn(`批量操作：目标名称 "${newName}" 已存在，已跳过 "${oldName}"。`);
                                toastr.warning(`主题 "${newName}" 已存在，跳过重命名。`);
                                skippedCount++;
                                continue;
                            }
                            if (newName !== oldName) {
                                const newThemeObject = { ...themeObject, name: newName };
                                await saveTheme(newThemeObject);
                                await deleteTheme(oldName);
                                manualUpdateOriginalSelect('rename', oldName, newName);
                            }
                            successCount++;
                        } catch (error) {
                            console.error(`批量重命名主题 "${oldName}" 时失败:`, error);
                            toastr.error(`处理主题 "${oldName}" 时失败: ${error.message}`);
                            errorCount++;
                        }
                    }

                    hideLoader();
                    selectedForBatch.clear();
                    
                    let summary = `批量操作完成！成功 ${successCount} 个`;
                    if (errorCount > 0) summary += `，失败 ${errorCount} 个`;
                    if (skippedCount > 0) summary += `，跳过 ${skippedCount} 个`;
                    summary += '。';
                    toastr.success(summary);

                    // 【核心修改】显示刷新提示
                    showRefreshNotification();
                    await buildThemeUI(); 
                }

                async function performBatchDelete() {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    if (!confirm(`确定要删除选中的 ${selectedForBatch.size} 个主题吗？`)) return;
                    
                    getCategoriesForThemes(selectedForBatch).forEach(cat => openCategoriesAfterRefresh.add(cat));

                    showLoader();
                    for (const themeName of selectedForBatch) {
                        const isCurrentlyActive = originalSelect.value === themeName;
                        await deleteTheme(themeName);
                        manualUpdateOriginalSelect('delete', themeName);
                        if (isCurrentlyActive) {
                            const azureOption = originalSelect.querySelector('option[value="Azure"]');
                            originalSelect.value = azureOption ? 'Azure' : (originalSelect.options[0]?.value || '');
                            originalSelect.dispatchEvent(new Event('change'));
                        }
                    }
                    selectedForBatch.clear();
                    hideLoader();
                    toastr.success('批量删除完成！');
                    
                    // 【核心修改】显示刷新提示
                    showRefreshNotification();
                    await buildThemeUI();
                }

                async function performBatchDissolve() {
                    if (selectedFoldersForBatch.size === 0) { toastr.info('请先选择至少一个文件夹。'); return; }
                    if (!confirm(`确定要解散选中的 ${selectedFoldersForBatch.size} 个文件夹吗？其中的所有主题将被移至“未分类”。`)) return;

                    showLoader();
                    let successCount = 0;
                    let errorCount = 0;
                    const themesToProcess = new Map();

                    selectedFoldersForBatch.forEach(folderName => {
                        openCategoriesAfterRefresh.add(folderName);
                        al

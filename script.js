(function () {
    'use strict';

    const initInterval = setInterval(() => {
        const originalSelect = document.querySelector('#themes');
        const updateButton = document.querySelector('#ui-preset-update-button');
        const saveAsButton = document.querySelector('#ui-preset-save-button');

        if (originalSelect && updateButton && saveAsButton && window.SillyTavern?.getContext && !document.querySelector('#theme-manager-panel')) {
            console.log("Theme Manager (v23.0 Final Stable): 初始化...");
            clearInterval(initInterval);

            try {
                const { getRequestHeaders, showLoader, hideLoader } = SillyTavern.getContext();
                const FAVORITES_KEY = 'themeManager_favorites';
                const COLLAPSE_KEY = 'themeManager_collapsed';
                const CATEGORY_ORDER_KEY = 'themeManager_categoryOrder';
                const COLLAPSED_FOLDERS_KEY = 'themeManager_collapsedFolders';
                const THEME_BACKGROUND_BINDINGS_KEY = 'themeManager_backgroundBindings';

                let allParsedThemes = [];
                let refreshNeeded = false;
                let isReorderMode = false;
                let isManageBgMode = false;
                let isBindingMode = false;
                let themeNameToBind = null;
                let selectedBackgrounds = new Set();
                let originalBgParent = null;

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
                async function deleteBackground(bgFile) { await apiRequest('backgrounds/delete', 'POST', { name: bgFile }); }
                async function uploadBackground(formData) {
                    const headers = getRequestHeaders();
                    delete headers['Content-Type'];
                    await fetch('/api/backgrounds/upload', { method: 'POST', headers, body: formData });
                }

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
                        <div id="theme-manager-refresh-notice" style="display:none; margin: 10px 0; padding: 10px; background-color: rgba(255, 193, 7, 0.15); border: 1px solid #ffc107; border-radius: 5px; text-align: center; color: var(--main-text-color);">
                            💡 <b>提示：</b>检测到主题文件变更。为确保所有更改完全生效，请在完成所有操作后
                            <a id="theme-manager-refresh-page-btn" style="color:var(--primary-color, #007bff); text-decoration:underline; cursor:pointer; font-weight:bold;">刷新页面</a>。
                        </div>
                        <div class="theme-manager-actions">
                            <input type="search" id="theme-search-box" placeholder="🔍 搜索主题...">
                            <button id="random-theme-btn" title="随机应用一个主题">🎲 随机</button>
                            <button id="batch-edit-btn" title="进入/退出批量编辑模式">🔧 批量编辑</button>
                            <button id="batch-import-btn" title="从文件批量导入主题">📂 批量导入</button>
                        </div>
                        <div class="theme-manager-actions">
                            <button id="reorder-mode-btn" title="调整文件夹顺序">🔄 调整顺序</button>
                            <button id="expand-all-btn" title="展开所有文件夹">全部展开</button>
                            <button id="collapse-all-btn" title="折叠所有文件夹">全部折叠</button>
                            <button id="manage-bgs-btn" title="管理背景图">🖼️ 管理背景</button>
                        </div>
                        <div id="background-actions-bar" style="display:none;">
                            <button id="batch-import-bg-btn">➕ 批量导入背景</button>
                            <button id="batch-delete-bg-btn">🗑️ 删除选中背景</button>
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
                const reorderModeBtn = managerPanel.querySelector('#reorder-mode-btn');
                const expandAllBtn = managerPanel.querySelector('#expand-all-btn');
                const collapseAllBtn = managerPanel.querySelector('#collapse-all-btn');
                const manageBgsBtn = managerPanel.querySelector('#manage-bgs-btn');
                const backgroundActionsBar = managerPanel.querySelector('#background-actions-bar');
                const batchImportBgBtn = managerPanel.querySelector('#batch-import-bg-btn');
                const batchDeleteBgBtn = managerPanel.querySelector('#batch-delete-bg-btn');
                
                const refreshNotice = managerPanel.querySelector('#theme-manager-refresh-notice');
                const refreshBtn = managerPanel.querySelector('#theme-manager-refresh-page-btn');
                refreshBtn.addEventListener('click', () => location.reload());

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

                const bgFileInput = document.createElement('input');
                bgFileInput.type = 'file';
                bgFileInput.multiple = true;
                bgFileInput.accept = 'image/*,video/*';
                bgFileInput.style.display = 'none';
                document.body.appendChild(bgFileInput);

                let favorites = JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
                let allThemeObjects = [];
                let isBatchEditMode = false;
                let selectedForBatch = new Set();
                let selectedFoldersForBatch = new Set();
                let originalBgParent = null; // 用于存储原生背景容器的父节点
                let themeBackgroundBindings = JSON.parse(localStorage.getItem(THEME_BACKGROUND_BINDINGS_KEY)) || {};

                function saveCategoryOrder() {
                    const newOrder = Array.from(contentWrapper.querySelectorAll('.theme-category'))
                        .map(div => div.dataset.categoryName)
                        .filter(name => name && name !== '⭐ 收藏夹' && name !== '未分类');
                    localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(newOrder));
                    toastr.info('文件夹顺序已保存。');
                }

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
                        
                        let savedOrder = JSON.parse(localStorage.getItem(CATEGORY_ORDER_KEY)) || [];
                        const savedOrderSet = new Set(savedOrder);
                        const newCategories = Array.from(allCategories).filter(cat => !savedOrderSet.has(cat) && cat !== '未分类' && cat !== '⭐ 收藏夹');
                        
                        const currentOrder = [...savedOrder.filter(cat => allCategories.has(cat)), ...newCategories.sort((a, b) => a.localeCompare(b, 'zh-CN'))];
                        localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(currentOrder));
                        
                        const categoryOrderMap = new Map(currentOrder.map((cat, index) => [cat, index]));
                        
                        const specialCategories = ['⭐ 收藏夹', '未分类'];
                        const sortedNormalCategories = Array.from(allCategories)
                            .filter(cat => !specialCategories.includes(cat))
                            .sort((a, b) => (categoryOrderMap.get(a) ?? Infinity) - (categoryOrderMap.get(b) ?? Infinity));
                        
                        const sortedCategories = ['⭐ 收藏夹', ...sortedNormalCategories];
                        if (allCategories.has('未分类')) {
                            sortedCategories.push('未分类');
                        }

                        const collapsedFolders = new Set(JSON.parse(localStorage.getItem(COLLAPSED_FOLDERS_KEY)) || []);

                        sortedCategories.forEach(category => {
                            const themesInCategory = (category === '⭐ 收藏夹') ? allParsedThemes.filter(t => favorites.includes(t.value)) : allParsedThemes.filter(t => t.tags.includes(category));
                            if (themesInCategory.length === 0 && category !== '未分类' && category !== '⭐ 收藏夹') return;

                            const categoryDiv = document.createElement('div');
                            categoryDiv.className = 'theme-category';
                            categoryDiv.dataset.categoryName = category;
                            const title = document.createElement('div');
                            title.className = 'theme-category-title';
                            
                            if (category !== '未分类' && category !== '⭐ 收藏夹') {
                                title.draggable = true;
                            }

                            let titleHTML = '';
                            if (category !== '未分类' && category !== '⭐ 收藏夹') {
                                titleHTML += `<input type="checkbox" class="folder-select-checkbox" title="选择文件夹进行批量操作">`;
                            }
                            titleHTML += `<span>${category}</span>`;
                            if (category !== '未分类' && category !== '⭐ 收藏夹') {
                                titleHTML += `
                                    <div class="folder-buttons">
                                        <button class="rename-folder-btn" title="重命名文件夹">✏️</button>
                                        <button class="dissolve-folder-btn" title="解散此文件夹">解散</button>
                                    </div>
                                    <div class="folder-reorder-buttons">
                                        <button class="move-folder-up-btn" title="上移">🔼</button>
                                        <button class="move-folder-down-btn" title="下移">🔽</button>
                                    </div>
                                `;
                            }
                            title.innerHTML = titleHTML;

                            const list = document.createElement('ul');
                            list.className = 'theme-list';
                            list.style.display = collapsedFolders.has(category) ? 'none' : 'block';

                            themesInCategory.forEach(theme => {
                                const item = document.createElement('li');
                                item.className = 'theme-item';
                                item.dataset.value = theme.value;
                                const isFavorited = favorites.includes(theme.value);
                                const starCharacter = isFavorited ? '★' : '☆';
                                const isBound = !!themeBackgroundBindings[theme.value];

                                item.innerHTML = `
                                    <span class="theme-item-name">${theme.display}</span>
                                    <div class="theme-item-buttons">
                                        <button class="link-bg-btn ${isBound ? 'linked' : ''}" title="关联背景图">🔗</button>
                                        <button class="unbind-bg-btn" style="display: ${isBound ? 'inline-block' : 'none'}" title="解绑背景">🚫</button>
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

                    } catch (err) {
                        contentWrapper.innerHTML = '加载主题失败，请检查浏览器控制台获取更多信息。';
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

                                if (themeBackgroundBindings[oldName]) {
                                    themeBackgroundBindings[newName] = themeBackgroundBindings[oldName];
                                    delete themeBackgroundBindings[oldName];
                                }
                            }
                            successCount++;
                        } catch (error) {
                            console.error(`批量重命名主题 "${oldName}" 时失败:`, error);
                            toastr.error(`处理主题 "${oldName}" 时失败: ${error.message}`);
                            errorCount++;
                        }
                    }
                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));

                    hideLoader();
                    selectedForBatch.clear();
                    
                    let summary = `批量操作完成！成功 ${successCount} 个`;
                    if (errorCount > 0) summary += `，失败 ${errorCount} 个`;
                    if (skippedCount > 0) summary += `，跳过 ${skippedCount} 个`;
                    summary += '。';
                    toastr.success(summary);

                    showRefreshNotification();
                    await buildThemeUI(); 
                }

                async function performBatchDelete() {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    if (!confirm(`确定要删除选中的 ${selectedForBatch.size} 个主题吗？`)) return;

                    showLoader();
                    for (const themeName of selectedForBatch) {
                        const isCurrentlyActive = originalSelect.value === themeName;
                        await deleteTheme(themeName);
                        manualUpdateOriginalSelect('delete', themeName);
                        if (themeBackgroundBindings[themeName]) {
                            delete themeBackgroundBindings[themeName];
                        }
                        if (isCurrentlyActive) {
                            const azureOption = originalSelect.querySelector('option[value="Azure"]');
                            originalSelect.value = azureOption ? 'Azure' : (originalSelect.options[0]?.value || '');
                            originalSelect.dispatchEvent(new Event('change'));
                        }
                    }
                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));

                    selectedForBatch.clear();
                    hideLoader();
                    toastr.success('批量删除完成！');
                    
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
                        allParsedThemes.forEach(theme => {
                            if (theme.tags.includes(folderName)) {
                                const newName = theme.value.replace(`[${folderName}]`, '').trim();
                                themesToProcess.set(theme.value, newName);
                            }
                        });
                    });

                    for (const [oldName, newName] of themesToProcess.entries()) {
                        try {
                            const themeObject = allThemeObjects.find(t => t.name === oldName);
                            if (themeObject) {
                                await saveTheme({ ...themeObject, name: newName });
                                await deleteTheme(oldName);
                                manualUpdateOriginalSelect('rename', oldName, newName);
                                if (themeBackgroundBindings[oldName]) {
                                    themeBackgroundBindings[newName] = themeBackgroundBindings[oldName];
                                    delete themeBackgroundBindings[oldName];
                                }
                                successCount++;
                            }
                        } catch(error) {
                            console.error(`解散文件夹时处理主题 "${oldName}" 失败:`, error);
                            errorCount++;
                        }
    
                    }
                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                    
                    hideLoader();
                    selectedFoldersForBatch.clear();
                    toastr.success(`批量解散完成！成功处理 ${successCount} 个主题，失败 ${errorCount} 个。`);
                    
                    showRefreshNotification();
                    buildThemeUI();
                }

                header.addEventListener('click', (e) => {
                    if (e.target.closest('#native-buttons-container')) return;
                    setCollapsed(content.style.maxHeight !== '0px', true);
                });

                searchBox.addEventListener('input', (e) => {
                    const searchTerm = e.target.value.toLowerCase();
                    const categories = managerPanel.querySelectorAll('.theme-category');
                    
                    if (searchTerm) {
                        categories.forEach(category => {
                            const list = category.querySelector('.theme-list');
                            if (list) list.style.display = 'none';
                        });
                    }

                    managerPanel.querySelectorAll('.theme-item').forEach(item => {
                        const isVisible = item.querySelector('.theme-item-name').textContent.toLowerCase().includes(searchTerm);
                        item.style.display = isVisible ? 'flex' : 'none';

                        if (isVisible && searchTerm) {
                            const parentCategory = item.closest('.theme-category');
                            if (parentCategory) {
                                const list = parentCategory.querySelector('.theme-list');
                                if (list) list.style.display = 'block';
                            }
                        }
                    });

                    if (!searchTerm) {
                        buildThemeUI();
                    }
                });

                randomBtn.addEventListener('click', async () => {
                    const themes = await getAllThemesFromAPI();
                    if (themes.length > 0) {
                        const randomIndex = Math.floor(Math.random() * themes.length);
                        originalSelect.value = themes[randomIndex].name;
                        originalSelect.dispatchEvent(new Event('change'));
                    }
                });
                
                reorderModeBtn.addEventListener('click', () => {
                    isReorderMode = !isReorderMode;
                    managerPanel.classList.toggle('reorder-mode', isReorderMode);
                    reorderModeBtn.classList.toggle('selected', isReorderMode);
                    reorderModeBtn.textContent = isReorderMode ? '完成排序' : '🔄 调整顺序';
                    if (isReorderMode && isBatchEditMode) batchEditBtn.click();
                    if (isReorderMode && isManageBgMode) manageBgsBtn.click();
                });

                batchEditBtn.addEventListener('click', () => {
                    isBatchEditMode = !isBatchEditMode;
                    managerPanel.classList.toggle('batch-edit-mode', isBatchEditMode);
                    batchActionsBar.classList.toggle('visible', isBatchEditMode);
                    batchEditBtn.classList.toggle('selected', isBatchEditMode);
                    batchEditBtn.textContent = isBatchEditMode ? '退出批量编辑' : '🔧 批量编辑';
                    
                    if (isBatchEditMode && isReorderMode) reorderModeBtn.click();
                     if (isBatchEditMode && isManageBgMode) manageBgsBtn.click();

                    if (!isBatchEditMode) {
                        selectedForBatch.clear();
                        selectedFoldersForBatch.clear();
                        managerPanel.querySelectorAll('.selected-for-batch').forEach(item => item.classList.remove('selected-for-batch'));
                        managerPanel.querySelectorAll('.theme-category-title.selected-for-batch').forEach(item => item.classList.remove('selected-for-batch'));
                        managerPanel.querySelectorAll('.folder-select-checkbox:checked').forEach(cb => cb.checked = false);
                    }
                });
                
                expandAllBtn.addEventListener('click', () => {
                    localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([]));
                    buildThemeUI();
                });
                
                collapseAllBtn.addEventListener('click', () => {
                    const allFolderNames = Array.from(contentWrapper.querySelectorAll('.theme-category'))
                        .map(div => div.dataset.categoryName)
                        .filter(name => name);
                    localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify(allFolderNames));
                    buildThemeUI();
                });

                fileInput.addEventListener('change', async (event) => {
                    const files = event.target.files;
                    if (!files.length) return;

                    showLoader();
                    let successCount = 0;
                    let errorCount = 0;

                    for (const file of files) {
                        try {
                            const fileContent = await file.text();
                            const themeObject = JSON.parse(fileContent);

                            if (themeObject && themeObject.name && typeof themeObject.main_text_color !== 'undefined') {
                                await saveTheme(themeObject);
                                successCount++;
                            } else {
                                console.warn(`文件 "${file.name}" 不是一个有效的主题文件，已跳过。`);
                                errorCount++;
                            }
                        } catch (err) {
                            console.error(`处理文件 "${file.name}" 时出错:`, err);
                            errorCount++;
                        }
                    }

                    hideLoader();
                    toastr.success(`批量导入完成！成功 ${successCount} 个，失败 ${errorCount} 个。正在刷新页面以应用更改...`);
                    
                    setTimeout(() => {
                        location.reload();
                    }, 1500);
                    
                    event.target.value = ''; 
                });

                batchImportBtn.addEventListener('click', () => {
                    fileInput.click();
                });

                document.querySelector('#batch-add-tag-btn').addEventListener('click', async () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    const newTag = prompt('请输入要添加的新标签（文件夹名）：');
                    if (newTag && newTag.trim()) {
                        await performBatchRename(oldName => `[${newTag.trim()}] ${oldName}`);
                    }
                });
                
                document.querySelector('#batch-move-tag-btn').addEventListener('click', async () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    const targetTag = prompt('请输入要移动到的目标分类（文件夹名）：');
                    
                    if (targetTag && targetTag.trim()) {
                        const sanitizedTag = targetTag.trim().replace(/[\\/:*?"<>|]/g, '');
                        if (sanitizedTag !== targetTag.trim()) {
                            toastr.warning(`分类名包含非法字符，已自动过滤为: "${sanitizedTag}"`);
                        }
                        if (!sanitizedTag) {
                            toastr.error('过滤后的分类名为空，操作已取消。');
                            return;
                        }
                        
                        await performBatchRename(oldName => `[${sanitizedTag}] ${oldName.replace(/\[.*?\]/g, '').trim()}`);
                    }
                });

                document.querySelector('#batch-delete-tag-btn').addEventListener('click', async () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    const tagToRemove = prompt('请输入要移除的标签（等同于将所选美化从以该标签命名的文件夹移出）：');
                    if (tagToRemove && tagToRemove.trim()) {
                        await performBatchRename(oldName => oldName.replace(`[${tagToRemove.trim()}]`, '').trim());
                    }
                });
                document.querySelector('#batch-delete-btn').addEventListener('click', performBatchDelete);
                document.querySelector('#batch-dissolve-btn').addEventListener('click', performBatchDissolve);

                contentWrapper.addEventListener('click', async (event) => {
                    const target = event.target;
                    const button = target.closest('button');
                    const themeItem = target.closest('.theme-item');
                    const categoryTitle = target.closest('.theme-category-title');
                    const folderCheckbox = target.closest('.folder-select-checkbox');

                    if (isBatchEditMode && folderCheckbox) {
                        event.stopPropagation();
                        
                        const titleElement = folderCheckbox.closest('.theme-category-title');
                        const categoryName = titleElement.parentElement.dataset.categoryName;
                        
                        if (folderCheckbox.checked) {
                            selectedFoldersForBatch.add(categoryName);
                            titleElement.classList.add('selected-for-batch');
                        } else {
                            selectedFoldersForBatch.delete(categoryName);
                            titleElement.classList.remove('selected-for-batch');
                        }
                        return;
                    }

                    if (categoryTitle) {
                        if (button && button.classList.contains('rename-folder-btn')) {
                            event.stopPropagation();
                            const categoryDiv = categoryTitle.closest('.theme-category');
                            const oldFolderName = categoryDiv.dataset.categoryName;
                            const newFolderName = prompt('请输入新的文件夹名称:', oldFolderName);

                            if (newFolderName && newFolderName.trim() && newFolderName !== oldFolderName) {
                                showLoader();
                                const themesToRename = allParsedThemes.filter(t => t.tags.includes(oldFolderName));
                                for (const theme of themesToRename) {
                                    const oldName = theme.value;
                                    const newName = oldName.replace(`[${oldFolderName}]`, `[${newFolderName.trim()}]`);
                                    const themeObject = allThemeObjects.find(t => t.name === oldName);
                                    if (themeObject) {
                                        await saveTheme({ ...themeObject, name: newName });
                                        await deleteTheme(oldName);
                                        manualUpdateOriginalSelect('rename', oldName, newName);
                                        if (themeBackgroundBindings[oldName]) {
                                            themeBackgroundBindings[newName] = themeBackgroundBindings[oldName];
                                            delete themeBackgroundBindings[oldName];
                                        }
                                    }
                                }
                                localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                                hideLoader();
                                toastr.success(`文件夹 "${oldFolderName}" 已重命名为 "${newFolderName.trim()}"`);
                                showRefreshNotification();
                                await buildThemeUI();
                            }
                            return;
                        }
                        
                        if (button && button.classList.contains('move-folder-up-btn')) {
                            event.stopPropagation();
                            const currentCategory = categoryTitle.parentElement;
                            const prevCategory = currentCategory.previousElementSibling;
                            if (prevCategory && prevCategory.dataset.categoryName !== '⭐ 收藏夹') {
                                contentWrapper.insertBefore(currentCategory, prevCategory);
                                saveCategoryOrder();
                            }
                            return;
                        }
                        
                        if (button && button.classList.contains('move-folder-down-btn')) {
                            event.stopPropagation();
                            const currentCategory = categoryTitle.parentElement;
                            const nextCategory = currentCategory.nextElementSibling;
                            if (nextCategory && nextCategory.dataset.categoryName !== '未分类') {
                                contentWrapper.insertBefore(nextCategory, currentCategory);
                                saveCategoryOrder();
                            }
                            return;
                        }

                        if (button && button.classList.contains('dissolve-folder-btn')) {
                            event.stopPropagation();
                            const categoryName = categoryTitle.closest('.theme-category').dataset.categoryName;
                            if (!confirm(`确定要解散文件夹 "${categoryName}" 吗？`)) return;
                            
                            showLoader();
                            const themesToUpdate = Array.from(originalSelect.options).map(opt => opt.value).filter(name => name.includes(`[${categoryName}]`));
                            for (const oldName of themesToUpdate) {
                                const themeObject = allThemeObjects.find(t => t.name === oldName);
                                if (!themeObject) continue;
                                const newName = oldName.replace(`[${categoryName}]`, '').trim();
                                await saveTheme({ ...themeObject, name: newName });
                                await deleteTheme(oldName);
                                manualUpdateOriginalSelect('rename', oldName, newName);
                                if (themeBackgroundBindings[oldName]) {
                                    themeBackgroundBindings[newName] = themeBackgroundBindings[oldName];
                                    delete themeBackgroundBindings[oldName];
                                }
                            }
                            localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                            hideLoader();
                            toastr.success(`文件夹 "${categoryName}" 已解散！`);
                            showRefreshNotification();
                            await buildThemeUI();
                        } else {
                            if (isReorderMode) return;
                            const list = categoryTitle.nextElementSibling;
                            if (list) {
                                const isHidden = list.style.display === 'none';
                                list.style.display = isHidden ? 'block' : 'none';
                                
                                const categoryName = categoryTitle.parentElement.dataset.categoryName;
                                let collapsedFolders = JSON.parse(localStorage.getItem(COLLAPSED_FOLDERS_KEY)) || [];
                                if (!isHidden) {
                                    if (!collapsedFolders.includes(categoryName)) {
                                        collapsedFolders.push(categoryName);
                                    }
                                } else {
                                    collapsedFolders = collapsedFolders.filter(name => name !== categoryName);
                                }
                                localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify(collapsedFolders));
                            }
                        }
                        return;
                    }

                    if (!themeItem) return;
                    const themeName = themeItem.dataset.value;

                    if (isBatchEditMode) {
                        if (selectedForBatch.has(themeName)) {
                            selectedForBatch.delete(themeName);
                            themeItem.classList.remove('selected-for-batch');
                        } else {
                            selectedForBatch.add(themeName);
                            themeItem.classList.add('selected-for-batch');
                        }
                    } else {
                        const categoryName = themeItem.closest('.theme-category').dataset.categoryName;

                        if (button && button.classList.contains('link-bg-btn')) {
                            isBindingMode = true;
                            themeNameToBind = themeName;
                            // 【核心修复】直接打开/关闭背景抽屉，避免返回主界面
                            const bgDrawer = document.querySelector('#Backgrounds');
                            const bgDrawerToggle = document.querySelector('#logo_block .drawer-toggle');
                            if (bgDrawer && bgDrawerToggle) {
                                const isOpen = bgDrawer.classList.contains('openDrawer');
                                if (!isOpen) {
                                    bgDrawerToggle.click();
                                }
                            }
                            toastr.info('请在背景面板中选择一张图片进行绑定。', '进入背景绑定模式');
                            return;
                        }

                        if (button && button.classList.contains('unbind-bg-btn')) {
                            delete themeBackgroundBindings[themeName];
                            localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                            toastr.success(`主题 "${themeItem.querySelector('.theme-item-name').textContent}" 已解绑背景。`);
                            await buildThemeUI();
                            return;
                        }

                        if (button && button.classList.contains('favorite-btn')) {
                            if (favorites.includes(themeName)) {
                                favorites = favorites.filter(f => f !== themeName);
                                button.textContent = '☆';
                            } else {
                                favorites.push(themeName);
                                button.textContent = '★';
                            }
                            localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
                            await buildThemeUI();
                        }
                        else if (button && button.classList.contains('rename-btn')) {
                            const oldName = themeName;
                            const newName = prompt(`请输入新名称：`, oldName);
                            if (newName && newName !== oldName) {
                                const themeObject = allThemeObjects.find(t => t.name === oldName);
                                if (!themeObject) return;
                                await saveTheme({ ...themeObject, name: newName });
                                await deleteTheme(oldName);
                                manualUpdateOriginalSelect('rename', oldName, newName);

                                if (themeBackgroundBindings[oldName]) {
                                    themeBackgroundBindings[newName] = themeBackgroundBindings[oldName];
                                    delete themeBackgroundBindings[oldName];
                                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                                }
                                
                                showRefreshNotification();
                                await buildThemeUI();
                            }
                        }
                        else if (button && button.classList.contains('delete-btn')) {
                            if (confirm(`确定要删除主题 "${themeItem.querySelector('.theme-item-name').textContent}" 吗？`)) {
                                const isCurrentlyActive = originalSelect.value === themeName;
                                await deleteTheme(themeName);
                                manualUpdateOriginalSelect('delete', themeName);

                                if (themeBackgroundBindings[themeName]) {
                                    delete themeBackgroundBindings[themeName];
                                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                                }

                                if (isCurrentlyActive) {
                                    const azureOption = originalSelect.querySelector('option[value="Azure"]');
                                    originalSelect.value = azureOption ? 'Azure' : (originalSelect.options[0]?.value || '');
                                    originalSelect.dispatchEvent(new Event('change'));
                                }
                                showRefreshNotification();
                                await buildThemeUI();
                            }
                        } else {
                            originalSelect.value = themeName;
                            originalSelect.dispatchEvent(new Event('change'));
                        }
                    }
                });

                originalSelect.addEventListener('change', (event) => {
                    updateActiveState();
                    const newThemeName = event.target.value;
                    const boundBg = themeBackgroundBindings[newThemeName];
                    if (boundBg) {
                        const bgElement = document.querySelector(`#bg_menu_content .bg_example[bgfile="${boundBg}"], #bg_custom_content .bg_example[bgfile="${boundBg}"]`);
                        if (bgElement) {
                            bgElement.click();
                        }
                    }
                });

                const observer = new MutationObserver((mutations) => {
                    buildThemeUI();
                });
                
                observer.observe(originalSelect, { childList: true, subtree: true, characterData: true });

                const bgMenuContent = document.getElementById('bg_menu_content');
                const bgCustomContent = document.getElementById('bg_custom_content');
                
                const bgObserverCallback = async (e) => {
                    if (!isBindingMode) return;

                    e.preventDefault();
                    e.stopPropagation();

                    const bgElement = e.target.closest('.bg_example');
                    if (!bgElement) return;

                    const bgFileName = bgElement.getAttribute('bgfile');
                    themeBackgroundBindings[themeNameToBind] = bgFileName;
                    localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));

                    toastr.success(`背景已成功绑定到主题！`);

                    isBindingMode = false;
                    themeNameToBind = null;
                    // 【核心修复】直接关闭背景抽屉
                    const bgDrawer = document.querySelector('#Backgrounds');
                    const bgDrawerToggle = document.querySelector('#logo_block .drawer-toggle');
                        if (bgDrawer && bgDrawerToggle) {
                        const isOpen = bgDrawer.classList.contains('openDrawer');
                        if (isOpen) {
                            bgDrawerToggle.click();
                        }
                    }

                    await buildThemeUI();
                };

                if (bgMenuContent) bgMenuContent.addEventListener('click', bgObserverCallback, true);
                if (bgCustomContent) bgCustomContent.addEventListener('click', bgObserverCallback, true);

                buildThemeUI().then(() => {
                    const isInitiallyCollapsed = localStorage.getItem(COLLAPSE_KEY) !== 'false';
                    setCollapsed(isInitiallyCollapsed, false);
                });

            } catch (error) {
                console.error("Theme Manager: 初始化过程中发生错误:", error);
            }
        }
    }, 250);
})();

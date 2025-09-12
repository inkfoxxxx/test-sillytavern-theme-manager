(function () {
    'use strict';

    const initInterval = setInterval(() => {
        const originalSelect = document.querySelector('#themes');
        const updateButton = document.querySelector('#ui-preset-update-button');
        const saveAsButton = document.querySelector('#ui-preset-save-button');

        if (originalSelect && updateButton && saveAsButton && window.SillyTavern?.getContext && !document.querySelector('#theme-manager-panel')) {
            console.log("Theme Manager (v23.0 Surgical DOM Update): 初始化...");
            clearInterval(initInterval);

            try {
                const { getRequestHeaders, showLoader, hideLoader } = SillyTavern.getContext();
                const FAVORITES_KEY = 'themeManager_favorites';
                const COLLAPSE_KEY = 'themeManager_collapsed';
                const THEME_BACKGROUND_BINDINGS_KEY = 'themeManager_backgroundBindings';

                let allParsedThemes = []; 
                let themeBackgroundBindings = JSON.parse(localStorage.getItem(THEME_BACKGROUND_BINDINGS_KEY)) || {};
                let isBindingMode = false; 
                let themeNameToBind = null;

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
                        <div class="theme-manager-actions">
                            <input type="search" id="theme-search-box" placeholder="🔍 搜索主题...">
                            <button id="random-theme-btn" title="随机应用一个主题">🎲 随机</button>
                            <button id="batch-edit-btn" title="进入/退出批量编辑模式">🔧 批量编辑</button>
                            <button id="batch-import-btn" title="从文件批量导入主题">📂 批量导入</button>
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

                // 【核心重构】不再销毁和重建UI，而是精确地更新、添加或删除元素
                async function buildOrUpdateThemeUI() {
                    const themesFromSelect = Array.from(originalSelect.options).map(option => option.value).filter(Boolean);
                    
                    // 如果UI还没创建，就执行完整的构建
                    if (contentWrapper.children.length === 0) {
                        await buildInitialThemeUI(themesFromSelect);
                    } else {
                        // 否则，执行微创更新
                        await updateExistingThemeUI(themesFromSelect);
                    }
                }
                
                // 仅在初次加载时调用的完整构建函数
                async function buildInitialThemeUI(themesFromSelect) {
                    contentWrapper.innerHTML = '正在加载主题...';
                    allThemeObjects = await getAllThemesFromAPI();
                    contentWrapper.innerHTML = '';

                    allParsedThemes = themesFromSelect.map(themeName => {
                        const tags = getTagsFromThemeName(themeName);
                        const displayName = themeName.replace(/\[.*?\]/g, '').trim() || themeName;
                        return { value: themeName, display: displayName, tags: tags };
                    });

                    const allCategories = new Set(allParsedThemes.flatMap(t => t.tags));
                    const sortedCategories = ['⭐ 收藏夹', ...Array.from(allCategories).sort((a, b) => a.localeCompare(b, 'zh-CN'))];

                    sortedCategories.forEach(category => createCategoryElement(category));
                    allParsedThemes.forEach(theme => insertThemeElement(theme));

                    updateActiveState();
                }

                // 【核心重构】用于后续更新的函数
                async function updateExistingThemeUI(themesFromSelect) {
                    allParsedThemes = themesFromSelect.map(themeName => {
                        const tags = getTagsFromThemeName(themeName);
                        const displayName = themeName.replace(/\[.*?\]/g, '').trim() || themeName;
                        return { value: themeName, display: displayName, tags: tags };
                    });
                    
                    // 检查并移除不再存在的主题
                    const currentThemeElements = contentWrapper.querySelectorAll('.theme-item');
                    currentThemeElements.forEach(item => {
                        if (!themesFromSelect.includes(item.dataset.value)) {
                            item.remove();
                        }
                    });

                    // 检查并更新或添加主题
                    allParsedThemes.forEach(theme => {
                        const existingItem = contentWrapper.querySelector(`.theme-item[data-value="${theme.value}"]`);
                        if (!existingItem) {
                            insertThemeElement(theme);
                        } else {
                            // 更新可能变化的收藏状态和绑定状态
                            const isFavorited = favorites.includes(theme.value);
                            const starCharacter = isFavorited ? '★' : '☆';
                            const isBound = !!themeBackgroundBindings[theme.value];
                            existingItem.querySelector('.favorite-btn').textContent = starCharacter;
                            existingItem.querySelector('.bind-bg-btn').classList.toggle('bound', isBound);
                            existingItem.querySelector('.unbind-bg-btn').style.display = isBound ? 'inline-block' : 'none';
                        }
                    });

                    // 检查并移除空的分类
                    const categoryElements = contentWrapper.querySelectorAll('.theme-category');
                    categoryElements.forEach(catDiv => {
                        const list = catDiv.querySelector('.theme-list');
                        if (list && list.children.length === 0 && catDiv.dataset.categoryName !== '⭐ 收藏夹') {
                            catDiv.remove();
                        }
                    });
                }
                
                // 【新增】创建分类DOM元素的辅助函数
                function createCategoryElement(category) {
                    if (contentWrapper.querySelector(`.theme-category[data-category-name="${category}"]`)) return;

                    const categoryDiv = document.createElement('div');
                    categoryDiv.className = 'theme-category';
                    categoryDiv.dataset.categoryName = category;
                    const title = document.createElement('div');
                    title.className = 'theme-category-title';
                    
                    let titleHTML = `<span>${category}</span>`;
                    if (category !== '未分类' && category !== '⭐ 收藏夹') {
                        titleHTML += `<button class="dissolve-folder-btn" title="解散此文件夹">解散</button>`;
                    }
                    title.innerHTML = titleHTML;

                    const list = document.createElement('ul');
                    list.className = 'theme-list';
                    list.style.display = 'block';

                    categoryDiv.appendChild(title);
                    categoryDiv.appendChild(list);
                    contentWrapper.appendChild(categoryDiv);
                    return categoryDiv;
                }
                
                // 【新增】插入主题DOM元素的辅助函数
                function insertThemeElement(theme) {
                    const item = document.createElement('li');
                    item.className = 'theme-item';
                    item.dataset.value = theme.value;
                    const isFavorited = favorites.includes(theme.value);
                    const starCharacter = isFavorited ? '★' : '☆';
                    const isBound = !!themeBackgroundBindings[theme.value];

                    item.innerHTML = `
                        <span class="theme-item-name">${theme.display}</span>
                        <div class="theme-item-buttons">
                            <button class="bind-bg-btn ${isBound ? 'bound' : ''}" title="绑定背景">🔗</button>
                            <button class="unbind-bg-btn" style="display: ${isBound ? 'inline-block' : 'none'}" title="解绑背景">🚫</button>
                            <button class="favorite-btn" title="收藏">${starCharacter}</button>
                            <button class="rename-btn" title="重命名">✏️</button>
                            <button class="delete-btn" title="删除">🗑️</button>
                        </div>`;
                    
                    // 插入到收藏夹
                    if (isFavorited) {
                        let favCategory = contentWrapper.querySelector('.theme-category[data-category-name="⭐ 收藏夹"]');
                        if (!favCategory) favCategory = createCategoryElement('⭐ 收藏夹');
                        favCategory.querySelector('.theme-list').appendChild(item.cloneNode(true));
                    }
                    
                    // 插入到其本身的分类
                    theme.tags.forEach(tag => {
                        let category = contentWrapper.querySelector(`.theme-category[data-category-name="${tag}"]`);
                        if (!category) category = createCategoryElement(tag);
                        category.querySelector('.theme-list').appendChild(item.cloneNode(true));
                    });
                }


                function updateActiveState() {
                    const currentValue = originalSelect.value;
                    managerPanel.querySelectorAll('.theme-item').forEach(item => {
                        item.classList.toggle('active', item.dataset.value === currentValue);
                    });
                }
                
                async function performBatchRename(renameLogic) {
                    if (selectedForBatch.size === 0) { return false; }
                    showLoader();
                    const currentThemes = await getAllThemesFromAPI();
                    for (const oldName of selectedForBatch) {
                        try {
                            const themeObject = currentThemes.find(t => t.name === oldName);
                            if (!themeObject) continue;
                            const newName = renameLogic(oldName);
                            if (currentThemes.some(t => t.name === newName && t.name !== oldName)) continue;
                            if (newName !== oldName) {
                                await saveTheme({ ...themeObject, name: newName });
                                await deleteTheme(oldName);
                            }
                        } catch (e) {
                            toastr.error(`处理主题 "${oldName}" 时失败: ${e.message}`);
                        }
                    }
                    hideLoader();
                    return true;
                }

                async function performBatchDelete() {
                    if (selectedForBatch.size === 0) { return false; }
                    if (!confirm(`确定要删除选中的 ${selectedForBatch.size} 个主题吗？`)) return false;
                    showLoader();
                    for (const themeName of selectedForBatch) {
                        await deleteTheme(themeName);
                    }
                    hideLoader();
                    return true;
                }

                header.addEventListener('click', (e) => {
                    if (e.target.closest('#native-buttons-container')) return;
                    setCollapsed(content.style.maxHeight !== '0px', true);
                });

                searchBox.addEventListener('input', (e) => {
                    const searchTerm = e.target.value.toLowerCase();
                    managerPanel.querySelectorAll('.theme-item').forEach(item => {
                        const isVisible = item.querySelector('.theme-item-name').textContent.toLowerCase().includes(searchTerm);
                        item.style.display = isVisible ? 'flex' : 'none';
                    });
                });

                randomBtn.addEventListener('click', async () => {
                    const themes = await getAllThemesFromAPI();
                    if (themes.length > 0) {
                        const randomIndex = Math.floor(Math.random() * themes.length);
                        originalSelect.value = themes[randomIndex].name;
                        originalSelect.dispatchEvent(new Event('change'));
                    }
                });

                batchEditBtn.addEventListener('click', () => {
                    isBatchEditMode = !isBatchEditMode;
                    managerPanel.classList.toggle('batch-edit-mode', isBatchEditMode);
                    batchActionsBar.classList.toggle('visible', isBatchEditMode);
                    batchEditBtn.classList.toggle('selected', isBatchEditMode);
                    batchEditBtn.textContent = isBatchEditMode ? '退出批量编辑' : '🔧 批量编辑';
                    if (!isBatchEditMode) {
                        selectedForBatch.clear();
                        selectedFoldersForBatch.clear();
                        managerPanel.querySelectorAll('.selected-for-batch').forEach(item => item.classList.remove('selected-for-batch'));
                        managerPanel.querySelectorAll('.theme-category-title.selected-for-batch').forEach(item => item.classList.remove('selected-for-batch'));
                        managerPanel.querySelectorAll('.folder-select-checkbox:checked').forEach(cb => cb.checked = false);
                    }
                });

                fileInput.addEventListener('change', async (event) => {
                    const files = event.target.files;
                    if (!files.length) return;
                    showLoader();
                    for (const file of files) {
                        try {
                            const fileContent = await file.text();
                            const themeObject = JSON.parse(fileContent);
                            if (themeObject && themeObject.name && typeof themeObject.main_text_color !== 'undefined') {
                                await saveTheme(themeObject);
                            }
                        } catch (err) {}
                    }
                    hideLoader();
                    setTimeout(() => location.reload(), 500);
                    event.target.value = ''; 
                });

                batchImportBtn.addEventListener('click', () => fileInput.click());

                document.querySelector('#batch-add-tag-btn').addEventListener('click', async () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    const newTag = prompt('请输入要添加的新标签（文件夹名）：');
                    if (newTag && newTag.trim()) {
                        const success = await performBatchRename(oldName => `[${newTag.trim()}] ${oldName}`);
                        if (success) setTimeout(() => location.reload(), 300);
                    }
                });
                
                document.querySelector('#batch-move-tag-btn').addEventListener('click', async () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    const targetTag = prompt('请输入要移动到的目标分类（文件夹名）：');
                    if (targetTag && targetTag.trim()) {
                        const sanitizedTag = targetTag.trim().replace(/[\\/:*?"<>|]/g, '');
                        if (sanitizedTag !== targetTag.trim()) toastr.warning(`分类名包含非法字符，已自动过滤为: "${sanitizedTag}"`);
                        if (!sanitizedTag) { toastr.error('过滤后的分类名为空，操作已取消。'); return; }
                        const success = await performBatchRename(oldName => `[${sanitizedTag}] ${oldName.replace(/\[.*?\]/g, '').trim()}`);
                        if (success) setTimeout(() => location.reload(), 300);
                    }
                });

                document.querySelector('#batch-delete-tag-btn').addEventListener('click', async () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    const tagToRemove = prompt('请输入要移除的标签：');
                    if (tagToRemove && tagToRemove.trim()) {
                        const success = await performBatchRename(oldName => oldName.replace(`[${tagToRemove.trim()}]`, '').trim());
                        if (success) setTimeout(() => location.reload(), 300);
                    }
                });

                document.querySelector('#batch-delete-btn').addEventListener('click', async () => {
                    const success = await performBatchDelete();
                    if (success) setTimeout(() => location.reload(), 300);
                });

                contentWrapper.addEventListener('click', async (event) => {
                    const target = event.target;
                    const button = target.closest('button');
                    const themeItem = target.closest('.theme-item');
                    const categoryTitle = target.closest('.theme-category-title');
                    
                    if (categoryTitle) {
                        const list = categoryTitle.nextElementSibling;
                        if (list) list.style.display = (list.style.display === 'none') ? 'block' : 'none';
                        return;
                    }

                    if (!themeItem) return;
                    const themeName = themeItem.dataset.value;

                    if (isBatchEditMode) {
                        themeItem.classList.toggle('selected-for-batch');
                        if (selectedForBatch.has(themeName)) selectedForBatch.delete(themeName);
                        else selectedForBatch.add(themeName);
                    } else {
                        if (button && button.classList.contains('favorite-btn')) {
                            if (favorites.includes(themeName)) {
                                favorites = favorites.filter(f => f !== themeName);
                            } else {
                                favorites.push(themeName);
                            }
                            localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
                            await buildOrUpdateThemeUI();
                        }
                        else if (button && button.classList.contains('bind-bg-btn')) {
                            isBindingMode = true;
                            themeNameToBind = themeName;
                            document.querySelector('#logo_block .drawer-toggle').click();
                            toastr.info('请在背景面板中选择一张图片进行绑定。', '进入背景绑定模式');
                        }
                        else if (button && button.classList.contains('unbind-bg-btn')) {
                            delete themeBackgroundBindings[themeName];
                            localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                            await buildOrUpdateThemeUI();
                        }
                        else if (button && button.classList.contains('rename-btn')) {
                            const oldName = themeName;
                            const newName = prompt(`请输入新名称：`, oldName);
                            if (newName && newName !== oldName) {
                                showLoader();
                                const themeObject = allThemeObjects.find(t => t.name === oldName);
                                if (themeObject) {
                                    await saveTheme({ ...themeObject, name: newName });
                                    await deleteTheme(oldName);
                                    if(themeBackgroundBindings[oldName]) {
                                        themeBackgroundBindings[newName] = themeBackgroundBindings[oldName];
                                        delete themeBackgroundBindings[oldName];
                                        localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                                    }
                                }
                                hideLoader();
                                setTimeout(() => location.reload(), 300);
                            }
                        }
                        else if (button && button.classList.contains('delete-btn')) {
                            if (confirm(`确定要删除主题 "${themeItem.querySelector('.theme-item-name').textContent}" 吗？`)) {
                                showLoader();
                                await deleteTheme(themeName);
                                delete themeBackgroundBindings[themeName];
                                localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                                hideLoader();
                                setTimeout(() => location.reload(), 300);
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
                        const bgElement = document.querySelector(`#bg_menu_content .bg_example[bgfile="${boundBg}"]`);
                        if (bgElement) bgElement.click();
                    }
                });
                
                // 【核心修复】SillyTavern 的“另存为”等操作会修改原生select，我们监听到后强制刷新页面
                const observer = new MutationObserver(() => {
                    console.log('Detected change in original select, reloading UI.');
                    setTimeout(() => location.reload(), 500);
                    observer.disconnect(); // 避免在刷新前触发更多次
                });
                observer.observe(originalSelect, { childList: true });
                
                const bgMenuContent = document.querySelector('#bg_menu_content');
                if (bgMenuContent) {
                    bgMenuContent.addEventListener('click', async (e) => {
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
                        document.querySelector('#logo_block .drawer-toggle').click();
                        await buildOrUpdateThemeUI();
                    }, true);
                }

                buildOrUpdateThemeUI().then(() => {
                    const isInitiallyCollapsed = localStorage.getItem(COLLAPSE_KEY) !== 'false';
                    setCollapsed(isInitiallyCollapsed, false);
                });

            } catch (error) {
                console.error("Theme Manager: 初始化过程中发生错误:", error);
            }
        }
    }, 250);
})();

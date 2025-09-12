(function () {
    'use strict';

    const initInterval = setInterval(() => {
        const originalSelect = document.querySelector('#themes');
        const updateButton = document.querySelector('#ui-preset-update-button');
        const saveAsButton = document.querySelector('#ui-preset-save-button');

        if (originalSelect && updateButton && saveAsButton && window.SillyTavern?.getContext && !document.querySelector('#theme-manager-panel')) {
            console.log("Theme Manager (v25.2 Final Logic Fix): 初始化...");
            clearInterval(initInterval);

            try {
                const { getRequestHeaders, showLoader, hideLoader, reloadThemes } = SillyTavern.getContext();
                const FAVORITES_KEY = 'themeManager_favorites';
                const COLLAPSE_KEY = 'themeManager_collapsed';
                const THEME_BACKGROUND_BINDINGS_KEY = 'themeManager_backgroundBindings';

                let themeBackgroundBindings = JSON.parse(localStorage.getItem(THEME_BACKGROUND_BINDINGS_KEY)) || {};
                let isBindingMode = false;
                let themeNameToBind = null;
                let allThemeObjects = [];

                async function apiRequest(endpoint, method = 'POST', body = {}) {
                    try {
                        const headers = getRequestHeaders();
                        const options = { method, headers };
                        if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
                            options.body = JSON.stringify(body);
                        }
                        const response = await fetch(`/api/${endpoint}`, options);
                        if (!response.ok) {
                            const errorText = await response.text();
                            try {
                                const errorData = JSON.parse(errorText);
                                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
                            } catch (e) {
                                throw new Error(errorText || `HTTP error! status: ${response.status}`);
                            }
                        }
                        const responseText = await response.text();
                        if (responseText.trim().toUpperCase() === 'OK') return { status: 'OK' };
                        return responseText ? JSON.parse(responseText) : {};
                    } catch (error) {
                        console.error(`API request to /api/${endpoint} failed:`, error);
                        toastr.error(`API请求失败: ${error.message}`);
                        throw error;
                    }
                }
                async function getAllThemesFromAPI() {
                    allThemeObjects = (await apiRequest('settings/get', 'POST', {})).themes || [];
                    return allThemeObjects;
                }
                async function deleteTheme(themeName) { return apiRequest('themes/delete', 'POST', { name: themeName }); }
                async function saveTheme(themeObject) { return apiRequest('themes/save', 'POST', themeObject); }
                
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
                let isBatchEditMode = false;
                let selectedForBatch = new Set();
                let selectedFoldersForBatch = new Set();
                
                function setCollapsed(isCollapsed, animate = false) {
                    if (isCollapsed) {
                        content.style.maxHeight = '0px';
                        content.style.paddingTop = '0px';
                        content.style.paddingBottom = '0px';
                        toggleIcon.classList.add('collapsed');
                        localStorage.setItem(COLLAPSE_KEY, 'true');
                    } else {
                        content.style.paddingTop = '';
                        content.style.paddingBottom = '';
                        content.style.maxHeight = content.scrollHeight + 'px';
                        if(animate) setTimeout(() => { content.style.maxHeight = ''; }, 300);
                        else content.style.maxHeight = '';
                        toggleIcon.classList.remove('collapsed');
                        localStorage.setItem(COLLAPSE_KEY, 'false');
                    }
                }

                function buildThemeUI() {
                    const scrollTopBefore = contentWrapper.scrollTop;
                    contentWrapper.innerHTML = ''; 

                    const themes = Array.from(originalSelect.options).map(option => {
                        const themeName = option.value;
                        if (!themeName) return null;
                        const tags = getTagsFromThemeName(themeName);
                        const displayName = themeName.replace(/\[.*?\]/g, '').trim() || themeName;
                        return { value: themeName, display: displayName, tags: tags };
                    }).filter(Boolean);

                    const allCategories = new Set(themes.flatMap(t => t.tags));
                    const sortedCategories = ['⭐ 收藏夹', ...Array.from(allCategories).sort((a, b) => a.localeCompare(b, 'zh-CN'))];

                    sortedCategories.forEach(category => {
                        const themesInCategory = (category === '⭐ 收藏夹') ? themes.filter(t => favorites.includes(t.value)) : themes.filter(t => t.tags.includes(category));
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
                        list.style.display = 'block';

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
                                    <button class="bind-bg-btn ${isBound ? 'bound' : ''}" title="绑定背景">🔗</button>
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
                    
                    contentWrapper.scrollTop = scrollTopBefore;
                    updateActiveState();
                }

                function updateActiveState() {
                    const currentValue = originalSelect.value;
                    managerPanel.querySelectorAll('.theme-item').forEach(item => {
                        item.classList.toggle('active', item.dataset.value === currentValue);
                    });
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
                    const themes = Array.from(originalSelect.options).map(opt => opt.value).filter(Boolean);
                    if (themes.length > 0) {
                        const randomIndex = Math.floor(Math.random() * themes.length);
                        originalSelect.value = themes[randomIndex];
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
                    let successCount = 0;
                    for (const file of files) {
                        try {
                            const fileContent = await file.text();
                            const themeObject = JSON.parse(fileContent);
                            if (themeObject && themeObject.name && typeof themeObject.main_text_color !== 'undefined') {
                                await saveTheme(themeObject);
                                successCount++;
                            }
                        } catch (err) {}
                    }
                    hideLoader();
                    if (successCount > 0) reloadThemes();
                    event.target.value = ''; 
                });

                batchImportBtn.addEventListener('click', () => fileInput.click());

                // 【核心修复】批量操作的统一处理函数
                async function performBatchAction(logic) {
                    showLoader();
                    const themes = await getAllThemesFromAPI(); // 获取最新、完整的对象数据
                    for (const oldName of selectedForBatch) {
                        try {
                            const themeObject = themes.find(t => t.name === oldName);
                            if (themeObject) {
                                await logic(oldName, themeObject);
                            }
                        } catch (err) {
                            toastr.error(`处理 "${oldName}" 时失败: ${err.message}`);
                        }
                    }
                    selectedForBatch.clear();
                    hideLoader();
                    reloadThemes();
                }

                document.querySelector('#batch-add-tag-btn').addEventListener('click', async () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    const newTag = prompt('请输入要添加的新标签（文件夹名）：');
                    if (newTag && newTag.trim()) {
                        await performBatchAction(async (oldName, themeObject) => {
                            const newName = `[${newTag.trim()}] ${oldName}`;
                            // 【核心修复】使用完整的 themeObject 进行保存
                            await saveTheme({ ...themeObject, name: newName });
                            await deleteTheme(oldName);
                        });
                    }
                });
                
                document.querySelector('#batch-move-tag-btn').addEventListener('click', async () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    const targetTag = prompt('请输入要移动到的目标分类（文件夹名）：');
                    if (targetTag && targetTag.trim()) {
                        const sanitizedTag = targetTag.trim().replace(/[\\/:*?"<>|]/g, '');
                        if (sanitizedTag !== targetTag.trim()) toastr.warning(`分类名包含非法字符，已自动过滤为: "${sanitizedTag}"`);
                        if (!sanitizedTag) { toastr.error('过滤后的分类名为空，操作已取消。'); return; }
                        await performBatchAction(async (oldName, themeObject) => {
                            const newName = `[${sanitizedTag}] ${oldName.replace(/\[.*?\]/g, '').trim()}`;
                            // 【核心修复】使用完整的 themeObject 进行保存
                            await saveTheme({ ...themeObject, name: newName });
                            await deleteTheme(oldName);
                        });
                    }
                });

                document.querySelector('#batch-delete-tag-btn').addEventListener('click', async () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    const tagToRemove = prompt('请输入要移除的标签：');
                    if (tagToRemove && tagToRemove.trim()) {
                        await performBatchAction(async (oldName, themeObject) => {
                            const newName = oldName.replace(`[${tagToRemove.trim()}]`, '').trim();
                             // 【核心修复】使用完整的 themeObject 进行保存
                            await saveTheme({ ...themeObject, name: newName });
                            await deleteTheme(oldName);
                        });
                    }
                });

                document.querySelector('#batch-delete-btn').addEventListener('click', async () => {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择至少一个主题。'); return; }
                    if (!confirm(`确定要删除选中的 ${selectedForBatch.size} 个主题吗？`)) return;
                    showLoader();
                    for(const themeName of selectedForBatch){
                        await deleteTheme(themeName);
                    }
                    hideLoader();
                    reloadThemes();
                });
                
                document.querySelector('#batch-dissolve-btn').addEventListener('click', async () => {
                     if (selectedFoldersForBatch.size === 0) { toastr.info('请先选择至少一个文件夹。'); return; }
                     if (!confirm(`确定要解散选中的 ${selectedFoldersForBatch.size} 个文件夹吗？`)) return;
                     showLoader();
                     const themes = await getAllThemesFromAPI();
                     for (const folderName of selectedFoldersForBatch) {
                         const themesInFolder = themes.filter(t => getTagsFromThemeName(t.name).includes(folderName));
                         for (const theme of themesInFolder) {
                            try {
                                const newName = theme.name.replace(`[${folderName}]`, '').trim();
                                await saveTheme({ ...theme, name: newName });
                                await deleteTheme(theme.name);
                            } catch (err) {
                                toastr.error(`处理 "${theme.name}" 时失败: ${err.message}`);
                            }
                         }
                     }
                     selectedFoldersForBatch.clear();
                     hideLoader();
                     reloadThemes();
                });


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
                        return;
                    }
                    
                    if (button) {
                        event.stopPropagation();
                        if (button.classList.contains('favorite-btn')) {
                            if (favorites.includes(themeName)) {
                                favorites = favorites.filter(f => f !== themeName);
                            } else {
                                favorites.push(themeName);
                            }
                            localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
                            buildThemeUI();
                        }
                        else if (button.classList.contains('bind-bg-btn')) {
                            isBindingMode = true;
                            themeNameToBind = themeName;
                            document.querySelector('#logo_block .drawer-toggle').click();
                            toastr.info('请在背景面板中选择一张图片进行绑定。', '进入背景绑定模式');
                        }
                        else if (button.classList.contains('unbind-bg-btn')) {
                            delete themeBackgroundBindings[themeName];
                            localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                            buildThemeUI();
                        }
                        else if (button.classList.contains('rename-btn')) {
                            const oldName = themeName;
                            const newName = prompt(`请输入新名称：`, oldName);
                            if (newName && newName !== oldName) {
                                showLoader();
                                const themeObjects = await getAllThemesFromAPI();
                                const themeObject = themeObjects.find(t => t.name === oldName);
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
                                reloadThemes();
                            }
                        }
                        else if (button.classList.contains('delete-btn')) {
                            if (confirm(`确定要删除主题 "${themeItem.querySelector('.theme-item-name').textContent}" 吗？`)) {
                                showLoader();
                                await deleteTheme(themeName);
                                delete themeBackgroundBindings[themeName];
                                localStorage.setItem(THEME_BACKGROUND_BINDINGS_KEY, JSON.stringify(themeBackgroundBindings));
                                hideLoader();
                                reloadThemes();
                            }
                        }
                    } else { 
                        originalSelect.value = themeName;
                        originalSelect.dispatchEvent(new Event('change'));
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
                
                const observer = new MutationObserver(() => {
                    console.log('Theme Manager: Detected change in original select, rebuilding UI.');
                    buildThemeUI();
                });
                observer.observe(originalSelect, { childList: true, attributes: true, subtree: true });
                
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
                        await buildThemeUI();
                    }, true);
                }

                buildThemeUI().then(() => {
                    const isInitiallyCollapsed = localStorage.getItem(COLLAPSE_KEY) !== 'false';
                    setCollapsed(isInitiallyCollapsed, false, false);
                });

            } catch (error) {
                console.error("Theme Manager: 初始化过程中发生错误:", error);
                if (contentWrapper) contentWrapper.innerHTML = '插件初始化失败，请检查浏览器控制台获取详细信息。';
            }
        }
    }, 250);
})();

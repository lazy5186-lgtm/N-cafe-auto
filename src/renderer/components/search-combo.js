// SearchCombo — 검색창이 들어있는 커스텀 드롭다운
//
// 원본 <select>는 화면에서만 숨기고 값/change 이벤트의 단일 출처로 그대로 둔다.
// 따라서 기존 코드(select.value 읽기, change 리스너, innerHTML로 옵션 재생성)는
// 손대지 않아도 그대로 동작한다.
//
// v1.8.7에서 카페 선택에만 손으로 짜 넣었던 콤보박스를 일반화한 것 —
// 카페/프리셋/게시 계정/댓글·대댓글 계정이 모두 이 하나를 쓴다.
//
// 사용:
//   SearchCombo.attach(selectEl, { searchPlaceholder: '계정 검색', emptyText: '계정 없음' })
//   SearchCombo.refresh(selectEl)   // 옵션을 바꾼 뒤 즉시 반영 (보통은 자동 감지됨)

let _openCombo = null;      // 동시에 열리는 콤보는 하나만
let _docClickBound = false;

// 가나다/ABC 오름차순. numeric:true → "3/9"가 "3/11"보다 앞
const _collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

class SearchComboBox {
  constructor(select, opts) {
    this.select = select;
    this.opts = opts || {};
    // 목록에서 빼고 항상 맨 아래에 고정으로 보여줄 값들 (예: 프리셋 "찾아보기...")
    this.actionValues = this.opts.actionValues || [];
    // 목록은 기본 오름차순 정렬 (원본 select의 옵션 순서는 그대로 둔다 — 값/인덱스는 건드리지 않음)
    this.sort = this.opts.sort !== false;
    this.activeIndex = -1; // 키보드로 이동 중인 항목의 select option index

    this._build();
    this._bind();
    this._syncLabel();
  }

  // ── DOM 생성 ─────────────────────────────────────────
  _build() {
    const root = document.createElement('div');
    root.className = 'combo';
    root.innerHTML = `
      <button type="button" class="input combo-toggle" aria-haspopup="listbox" aria-expanded="false">
        <span class="combo-label"></span>
        <span class="combo-caret">&#9662;</span>
      </button>
      <div class="combo-panel">
        <input type="text" class="combo-search" autocomplete="off">
        <div class="combo-count"></div>
        <div class="combo-list" role="listbox"></div>
      </div>
    `;
    root.style.width = this.select.style.width || '100%';
    // wide: 펼친 목록을 버튼 폭에 맞추지 않고 내용만큼 넓힌다 (항목이 길어 잘리는 드롭다운용)
    if (this.opts.wide) root.classList.add('wide');
    if (this.opts.rootStyle) root.style.cssText += this.opts.rootStyle;

    this.root = root;
    this.btn = root.querySelector('.combo-toggle');
    this.label = root.querySelector('.combo-label');
    this.panel = root.querySelector('.combo-panel');
    this.search = root.querySelector('.combo-search');
    this.countEl = root.querySelector('.combo-count');
    this.list = root.querySelector('.combo-list');
    this.search.placeholder = this.opts.searchPlaceholder || '검색';

    this.select.style.display = 'none';
    this.select.insertAdjacentElement('afterend', root);
    this.select._combo = this;
  }

  _bind() {
    this.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.root.classList.contains('open')) this.close();
      else this.open();
    });

    this.btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.open();
      }
    });

    this.search.addEventListener('input', () => this._renderList());

    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); this.btn.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this._moveActive(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this._moveActive(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.activeIndex >= 0) this.pick(this.activeIndex);
      } else if (e.key === 'Tab') {
        this.close();
      }
    });

    // 옵션이 innerHTML로 새로 그려지거나(childList) disabled/색상이 바뀌면(attributes) 자동 반영
    this._observer = new MutationObserver(() => this.refresh());
    this._observer.observe(this.select, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'style'],
    });

    // 코드가 select.value를 직접 바꾸는 경우까지 라벨을 맞춰줌
    // (change 핸들러가 값을 되돌리는 흐름 — 프리셋 "찾아보기..." — 때문에 다음 틱에도 한 번 더)
    this.select.addEventListener('change', () => {
      this._syncLabel();
      setTimeout(() => this._syncLabel(), 0);
    });

    if (!_docClickBound) {
      _docClickBound = true;
      document.addEventListener('click', (e) => {
        if (_openCombo && e.target.closest('.combo') !== _openCombo.root) _openCombo.close();
      });
    }
  }

  // ── 상태 ────────────────────────────────────────────
  open() {
    if (this.select.disabled) return;
    if (_openCombo && _openCombo !== this) _openCombo.close();
    this.root.classList.add('open');
    this.btn.setAttribute('aria-expanded', 'true');
    this.search.value = '';
    this._renderList();
    this.search.focus();
    _openCombo = this;
  }

  close() {
    this.root.classList.remove('open');
    this.btn.setAttribute('aria-expanded', 'false');
    if (_openCombo === this) _openCombo = null;
  }

  // 목록에서 항목 선택 → 숨겨진 select에 반영하고 기존 change 흐름을 그대로 실행
  pick(optIndex) {
    const select = this.select;
    if (optIndex < 0 || optIndex >= select.options.length) return;
    select.selectedIndex = optIndex;
    select.dispatchEvent(new Event('change'));
    this._syncLabel();
    this.close();
  }

  refresh() {
    this._syncLabel();
    if (this.root.classList.contains('open')) this._renderList();
  }

  destroy() {
    if (this._observer) this._observer.disconnect();
    if (_openCombo === this) _openCombo = null;
    this.root.remove();
    this.select.style.display = '';
    delete this.select._combo;
  }

  // ── 렌더 ────────────────────────────────────────────
  _placeholderOption() {
    return Array.from(this.select.options).find(o => o.value === '') || null;
  }

  _syncLabel() {
    const opt = this.select.options[this.select.selectedIndex];
    const chosen = opt && opt.value !== '';
    const ph = this._placeholderOption();
    this.label.textContent = chosen
      ? opt.textContent
      : (this.opts.placeholder || (ph ? ph.textContent : '선택...'));
    // 옵션에 색이 칠해져 있으면(댓글 계정 색상 시스템) 라벨에도 그대로 보여준다
    this.label.style.color = chosen ? (opt.style.color || '#e0e0e0') : '#5a6485';
    this.label.style.fontWeight = chosen ? (opt.style.fontWeight || '') : '';

    const disabled = this.select.disabled;
    this.root.classList.toggle('disabled', disabled);
    this.btn.disabled = disabled;
    if (disabled && this.root.classList.contains('open')) this.close();
  }

  _renderList() {
    const q = this.search.value.trim().toLowerCase();
    const all = Array.from(this.select.options);
    const items = all.filter(o => o.value !== '' && !this.actionValues.includes(o.value));
    const actions = all.filter(o => this.actionValues.includes(o.value));
    const shown = items.filter(o => !q || (o.textContent + ' ' + o.value).toLowerCase().includes(q));
    if (this.sort) shown.sort((a, b) => _collator.compare(a.textContent, b.textContent));

    if (!items.length) this.countEl.textContent = this.opts.emptyText || '';
    else if (q) this.countEl.textContent = `검색 ${shown.length} / 전체 ${items.length}개`;
    else this.countEl.textContent = `전체 ${items.length}개`;

    this.list.innerHTML = '';
    const selIdx = this.select.selectedIndex;

    // 활성 항목: 검색 중이면 첫 결과, 아니면 현재 선택된 항목
    const preferred = (!q && selIdx > 0) ? selIdx : -1;
    this.activeIndex = shown.some(o => o.index === preferred)
      ? preferred
      : (shown.length ? shown[0].index : -1);

    // 선택을 지울 수 있게 — 이미 고른 값이 있고 검색 중이 아닐 때만 안내 옵션을 위에 노출
    const ph = this._placeholderOption();
    if (ph && !q && selIdx > 0) this._appendItem(ph, selIdx, true);

    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'combo-empty';
      empty.textContent = items.length ? '검색 결과 없음' : '';
      this.list.appendChild(empty);
    }

    shown.forEach(o => this._appendItem(o, selIdx, false));
    actions.forEach(o => this._appendItem(o, selIdx, true));

    const activeEl = this.list.querySelector('.combo-item.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  _appendItem(opt, selIdx, muted) {
    const item = document.createElement('div');
    item.className = 'combo-item'
      + (opt.index === selIdx ? ' selected' : '')
      + (opt.index === this.activeIndex ? ' active' : '')
      + (muted ? ' muted' : '');
    item.textContent = opt.textContent;
    item.title = opt.textContent;
    item.dataset.index = String(opt.index);
    item.setAttribute('role', 'option');
    if (!muted && opt.style.color) {
      item.style.color = opt.style.color;
      item.style.fontWeight = opt.style.fontWeight || '';
    }
    item.addEventListener('mousedown', (e) => {
      e.preventDefault(); // 검색창 blur 방지
      this.pick(opt.index);
    });
    this.list.appendChild(item);
  }

  // 키보드 위/아래로 활성 항목 이동
  _moveActive(delta) {
    const els = Array.from(this.list.querySelectorAll('.combo-item:not(.muted)'));
    if (!els.length) return;
    let pos = els.findIndex(el => Number(el.dataset.index) === this.activeIndex);
    pos = Math.max(0, Math.min(els.length - 1, (pos < 0 ? 0 : pos + delta)));
    this.activeIndex = Number(els[pos].dataset.index);
    els.forEach(el => el.classList.toggle('active', Number(el.dataset.index) === this.activeIndex));
    els[pos].scrollIntoView({ block: 'nearest' });
  }
}

const SearchCombo = {
  // 이미 붙어 있으면 새로 만들지 않고 갱신만 — 재렌더 흐름에서 그냥 호출하면 된다
  attach(select, opts) {
    if (!select) return null;
    if (select._combo) {
      select._combo.refresh();
      return select._combo;
    }
    return new SearchComboBox(select, opts || {});
  },

  refresh(select) {
    if (select && select._combo) select._combo.refresh();
  },
};

const app=document.querySelector('#app'),toastEl=document.querySelector('#toast');
const categories=[['🔧','Ремонт','2 410'],['🧹','Уборка','1 280'],['🚚','Перевозки','870'],['💻','IT и дизайн','3 540'],['📚','Обучение','2 130'],['🐾','Животные','940'],['💅','Красота','1 760'],['📸','Фото и видео','640'],['🌿','Сад и дача','720'],['⚖️','Юристы','580'],['🎉','Мероприятия','430'],['➕','Все услуги','14 800']];
const seed=[
{id:1,icon:'🔧',title:'Мастер на час',cat:'Ремонт',name:'Алексей Морозов',rating:4.9,reviews:128,price:'от 1 500 ₽',city:'Москва',verified:true,selfEmployed:true,pro:true,distance:1.2,response:'5 минут',desc:'Сборка мебели, электрика и мелкий бытовой ремонт.',online:true,lat:55.766,lng:37.621},
{id:2,icon:'🧹',title:'Уборка квартиры',cat:'Уборка',name:'Clean Pro',rating:4.8,reviews:94,price:'от 2 300 ₽',city:'Москва',verified:true,company:true,pro:true,distance:2.4,response:'10 минут',desc:'Поддерживающая и генеральная уборка с материалами.',online:true,lat:55.751,lng:37.607},
{id:3,icon:'💻',title:'Сайт и фирменный стиль',cat:'IT и дизайн',name:'Мария К.',rating:5.0,reviews:67,price:'от 12 000 ₽',city:'Онлайн',verified:true,selfEmployed:true,pro:true,distance:null,response:'30 минут',desc:'Дизайн, лендинги и упаковка бизнеса под ключ.',online:false,lat:55.744,lng:37.648},
{id:4,icon:'🚚',title:'Грузовое такси',cat:'Перевозки',name:'Иван Петров',rating:4.7,reviews:211,price:'от 900 ₽/ч',city:'Москва',verified:true,ip:true,distance:3.1,response:'15 минут',desc:'Газель, грузчики, квартирные и офисные переезды.',online:true,lat:55.78,lng:37.59},
{id:5,icon:'📚',title:'Репетитор по математике',cat:'Обучение',name:'Ольга Смирнова',rating:4.9,reviews:83,price:'от 1 200 ₽',city:'Онлайн',verified:true,selfEmployed:true,distance:null,response:'1 час',desc:'Подготовка к ОГЭ и ЕГЭ, понятное объяснение.',online:false,lat:55.735,lng:37.618},
{id:6,icon:'🐾',title:'Выгул и передержка собак',cat:'Животные',name:'Анна Лебедева',rating:5.0,reviews:44,price:'от 700 ₽',city:'Москва',verified:true,selfEmployed:true,distance:.8,response:'5 минут',desc:'Бережный уход, фотоотчёт и прогулки по графику.',online:true,lat:55.757,lng:37.642},
{id:7,icon:'💅',title:'Маникюр с выездом',cat:'Красота',name:'Диана',rating:4.9,reviews:76,price:'от 1 900 ₽',city:'Москва',verified:true,selfEmployed:true,distance:4.2,response:'20 минут',desc:'Стерильные инструменты, большая палитра и выезд.',online:true,lat:55.72,lng:37.61},
{id:8,icon:'📸',title:'Семейная фотосессия',cat:'Фото и видео',name:'Роман С.',rating:4.8,reviews:52,price:'от 6 000 ₽',city:'Москва',verified:true,selfEmployed:true,distance:2.8,response:'40 минут',desc:'Живые кадры, помощь с образами, готовность 7 дней.',online:false,lat:55.79,lng:37.64}
];
const store=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}};
const privateLocalKeys=['pm_user','pm_tasks','pm_messages','pm_trust_score'];
privateLocalKeys.forEach(key=>localStorage.removeItem(key));
let state={session:null,cloudReady:false,page:'home',bonusBalance:store('pm_bonus_balance',0),trustScore:0,filter:'Все',query:'',createMode:'task',view:'list',radius:store('pm_radius',5),locationName:store('pm_location','Москва'),role:store('pm_role','customer'),fav:store('pm_fav',[]),services:[...seed],tasks:[],messages:[],user:{name:'',city:'Москва',verified:false}};
// В localStorage остаются только настройки интерфейса и демонстрационный баланс.
// Профиль, задания и сообщения хранятся только в текущей вкладке.
const save=()=>{localStorage.setItem('pm_bonus_balance',JSON.stringify(state.bonusBalance));localStorage.setItem('pm_role',JSON.stringify(state.role));localStorage.setItem('pm_radius',JSON.stringify(state.radius));localStorage.setItem('pm_location',JSON.stringify(state.locationName));localStorage.setItem('pm_fav',JSON.stringify(state.fav))};
function toast(t){toastEl.textContent=t;toastEl.classList.add('show');setTimeout(()=>toastEl.classList.remove('show'),1900)}
const escapeHtml=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function nav(){return `<nav class="nav">${[['home','⌂','Главная'],['catalog','⌕','Поиск'],['create','＋','Создать'],['chats','✉','Чаты'],['profile','♙','Профиль']].map(x=>`<button class="${state.page===x[0]?'active':''}" onclick="go('${x[0]}')"><i>${x[1]}</i>${x[2]}</button>`).join('')}</nav>`}
function avatarMarkup(size='small'){
  const cls=size==='large'?'avatar avatarLarge':'avatar';
  return `<button class="${cls} avatarGuest" aria-label="${state.session?'Открыть профиль':'Войти или зарегистрироваться'}" onclick="handleTopAvatar()"><span class="personGlyph" aria-hidden="true">♙</span></button>`;
}
function handleTopAvatar(){if(state.session)go('profile');else showWelcomeAuth()}
function showWelcomeAuth(){modal(`<div class="welcomeAuth"><div class="welcomeAvatar"><span class="personGlyph">♙</span></div><h2>Добро пожаловать в Помогай</h2><p class="muted">Войдите, чтобы помогать и получать помощь.</p><div class="authChoice"><button class="btn primary" onclick="closeModal();showAuth('login')">Войти</button><button class="btn outline" onclick="closeModal();showAuth('signup')">Создать аккаунт</button></div></div>`)}
function shell(content){app.innerHTML=`<div class="app ${state.page==='profile'?'profilePage':''}"><header class="topbar"><div class="topin topinMinimal"><div class="topSpacer" aria-hidden="true"></div><button class="centerBrand" onclick="go('home')" aria-label="На главную"><span>Помогай</span><b>🤝</b></button><div class="topAccount">${avatarMarkup()}</div></div></header><main class="main">${content}</main>${nav()}</div>`}
function showAccountMenu(){
  if(!state.session)return showAuth('login');
  modal(`<div class="accountMenuHead">${avatarMarkup('large')}<div><h2>${escapeHtml(state.user.name||'Пользователь')}</h2><div class="muted">${escapeHtml(state.user.city||'Москва')}</div></div></div><div class="accountMenuList"><button onclick="closeModal();go('profile')">👤 <span>Мой профиль</span><b>›</b></button><button onclick="closeModal();editProfile()">✏️ <span>Редактировать профиль</span><b>›</b></button><button onclick="closeModal();go('profile')">⭐ <span>Избранное</span><b>›</b></button><button onclick="closeModal();go('create')">📢 <span>Мои объявления</span><b>›</b></button><button onclick="closeModal();go('chats')">💬 <span>Чаты</span><b>›</b></button><button onclick="closeModal();startHelping()">🤝 <span>Начать помогать</span><b>›</b></button><button onclick="closeModal();go('profile')">⚙️ <span>Настройки</span><b>›</b></button><button class="logoutMenu" onclick="closeModal();signOut()">🚪 <span>Выйти</span><b>›</b></button></div>`)
}
function filtered(){let a=[...state.services];if(state.filter!=='Все')a=a.filter(x=>x.cat===state.filter);if(state.query.trim()){const q=state.query.toLowerCase();a=a.filter(x=>(x.title+x.cat+x.name+x.desc+x.city).toLowerCase().includes(q))}return a.sort((a,b)=>(b.pro-a.pro)||(a.distance??99)-(b.distance??99)||b.rating-a.rating)}
function badges(s){return `${s.pro?'<span class="badge pro">PRO</span>':''}${s.verified?'<span class="badge verifiedBadge">✓ Проверен</span>':''}${s.selfEmployed?'<span class="badge neutral">Самозанятый</span>':''}${s.ip?'<span class="badge neutral">ИП</span>':''}${s.company?'<span class="badge neutral">Компания</span>':''}`}
function cards(items){if(!items.length)return `<div class="empty panel">Ничего не найдено. Попробуйте другой запрос или категорию.</div>`;return `<div class="grid">${items.map(s=>`<article class="card"><div class="cover">${s.icon}<button class="favbtn" aria-label="Избранное" onclick="event.stopPropagation();fav(${JSON.stringify(s.id)})">${state.fav.includes(s.id)?'♥':'♡'}</button></div><div class="cardbody"><div class="badges">${badges(s)}</div><span class="rating">★ ${s.rating} · ${s.reviews}</span><h3>${escapeHtml(s.title)}</h3><div class="muted">${escapeHtml(s.name)} · ${escapeHtml(s.city)}</div><div class="micro">${s.distance!=null?`📍 ${s.distance} км · `:''}⚡ Ответит за ${escapeHtml(s.response)}</div><p class="muted desc">${escapeHtml(s.desc)}</p><div class="row"><span class="price">${escapeHtml(s.price)}</span><button class="btn soft" onclick="openService(${JSON.stringify(s.id)})">Связаться</button></div></div></article>`).join('')}</div>`}
function home(){shell(`<section class="hero"><div><h1>Помощь рядом с вами</h1><p>Специалисты, услуги и задачи рядом с вами — в одном удобном приложении.</p></div><div class="heroVisual"><div class="visualCard"><div class="big">🤝</div><b>Люди помогают людям</b><small>Проверенные помощники рядом</small></div></div></section><div class="choiceGrid"><button class="choiceCard help" onclick="go('catalog')"><span class="choiceIcon circleIcon">⌕</span><b>Найти помощь</b><span>Найти специалиста или услугу</span></button><button class="choiceCard give" onclick="state.createMode='task';go('create')"><span class="choiceIcon circleIcon">＋</span><b>Нужна помощь</b><span>Разместить задачу и получить отклики</span></button></div><section class="section"><div class="sectionHead"><div><h2>Популярные категории</h2><div class="muted">Выберите направление помощи</div></div><button class="sectionLink" onclick="setFilter('Все')">Смотреть все&nbsp;›</button></div><div class="cats">${categories.slice(0,6).map(c=>`<div class="cat" onclick="setFilter('${c[1]}')"><div class="ico">${c[0]}</div><b>${c[1]}</b><span>${c[2]} специалистов</span></div>`).join('')}</div></section><section class="section"><div class="sectionHead"><div><h2>Специалисты</h2><div class="muted">Проверенные исполнители с высоким рейтингом</div></div><button class="sectionLink" onclick="go('catalog')">Смотреть все&nbsp;›</button></div>${cards(filtered().slice(0,3))}</section>`) }
function catalog(){const items=filtered();shell(`<section><div class="catalogSearchRow"><label class="searchbox catalogSearch"><span class="searchIcon" aria-hidden="true">⌕</span><input id="q" aria-label="Поиск" placeholder="Услуга, специалист или задача" value="${escapeHtml(state.query)}"></label><button class="locationBtn catalogLocation" aria-label="Геолокация и карта" onclick="showLocationMenu()"><span>📍</span><small>${escapeHtml(state.locationName)}</small></button></div><div class="sectionHead"><div><h2>Специалисты и услуги</h2><div class="muted">${items.length} предложений</div></div><button class="btn outline filterOnlyBtn" onclick="showFilters()">⚙ Фильтры</button></div><div class="chips">${['Все',...categories.slice(0,-1).map(x=>x[1])].map(x=>`<button class="chip ${state.filter===x?'active':''}" onclick="setFilter('${x}')">${x}</button>`).join('')}</div></section><section class="section">${state.view==='map'?mapView(items):cards(items)}</section>`) }
function mapView(items){const nearby=items.filter(x=>x.distance==null||x.distance<=state.radius);return `<div class="nearbySummary"><div><b>Рядом с вами</b><span>🟢 Помощники: ${nearby.length} · 🛑 Задачи: ${Math.max(2,state.tasks.length||3)}</span></div><button class="btn outline" onclick="showLocationMenu()">📍 ${escapeHtml(state.locationName)}</button></div><div class="radiusBar"><label>Радиус: <b>${state.radius} км</b></label><input type="range" min="1" max="50" step="1" value="${state.radius}" oninput="setRadius(this.value)"></div><div class="mapWrap"><div class="mapCanvas">${nearby.filter(x=>x.lat).map((s,i)=>`<button class="mapPin helperPin" style="left:${14+(i*13)%72}%;top:${16+(i*19)%65}%" onclick="openService(${JSON.stringify(s.id)})">🟢<span>${escapeHtml(s.title)}</span></button>`).join('')}${[0,1,2].map((_,i)=>`<button class="mapPin taskPin" style="left:${28+(i*21)%58}%;top:${31+(i*23)%52}%" onclick="state.createMode='task';go('create')">🛑<span>Нужна помощь</span></button>`).join('')}<div class="mapCenter">📍 Вы здесь</div></div><div class="mapList"><div class="mapActions"><button class="btn primary" onclick="state.view='list';render()">🟢 Найти помощь</button><button class="btn danger" onclick="state.createMode='task';go('create')">🛑 Нужна помощь</button></div>${nearby.slice(0,5).map(s=>`<div class="listItem" onclick="openService(${JSON.stringify(s.id)})"><div class="thumb">${s.icon}</div><div><b>${escapeHtml(s.title)}</b><div class="muted">${s.distance??'онлайн'} ${s.distance!=null?'км':''} · ${escapeHtml(s.price)}</div></div><div class="spacer"></div>›</div>`).join('')}</div></div>`}
function create(){shell(`<section class="panel createPanel"><div class="createIntro"><h2>Создать объявление</h2><p>Разместите задачу или предложите свою услугу</p></div><div class="seg"><button class="${state.createMode==='task'?'active':''}" onclick="state.createMode='task';render()">Нужна помощь</button><button class="${state.createMode==='service'?'active':''}" onclick="state.createMode='service';render()">Предлагаю услугу</button></div><div style="margin-top:18px">${state.createMode==='task'?taskFields():serviceFields()}</div></section><section class="section"><div class="sectionHead"><h2>Мои публикации</h2><span class="muted">${state.tasks.length}</span></div><div class="list">${state.tasks.length?state.tasks.map(t=>`<div class="listItem"><div class="thumb">📋</div><div><b>${escapeHtml(t.title)}</b><div class="muted">${escapeHtml(t.budget)} · ${escapeHtml(t.city)}</div></div><div class="spacer"></div><span class="status">Опубликовано</span></div>`).join(''):'<div class="empty panel">Публикаций пока нет</div>'}</div></section>`) }
function taskFields(){return `<form class="form" onsubmit="addTask(event)"><div class="field"><label>Что нужно сделать?</label><input name="title" required minlength="3" maxlength="120" placeholder="Например, собрать шкаф"></div><div class="field"><label>Категория</label><select name="cat">${categories.slice(0,-1).map(x=>`<option>${x[1]}</option>`).join('')}</select></div><div class="field"><label>Описание</label><textarea name="desc" required minlength="10" maxlength="4000" placeholder="Добавьте детали, сроки и пожелания"></textarea></div><div class="field"><label>Адрес</label><input name="city" required maxlength="200" value="Москва"></div><div class="field"><label>Дата и время</label><input name="date" type="datetime-local"></div><div class="field"><label>Бюджет</label><input name="budget" type="number" min="0" step="1" required placeholder="5000"></div><div class="notice">Загрузка фотографий пока не подключена.</div><button class="btn primary">Опубликовать задачу</button></form>`}
function serviceFields(){return `<form class="form" onsubmit="addService(event)"><div class="field"><label>Название услуги</label><input name="title" required minlength="3" maxlength="120" placeholder="Например, ремонт стиральных машин"></div><div class="field"><label>Категория</label><select name="cat">${categories.slice(0,-1).map(x=>`<option>${x[1]}</option>`).join('')}</select></div><div class="field"><label>Описание</label><textarea name="desc" required minlength="10" maxlength="4000" placeholder="Расскажите об опыте и условиях"></textarea></div><div class="field"><label>Цена от</label><input name="price" type="number" min="0" step="1" required placeholder="1000"></div><div class="notice">Профессиональный статус и фотографии добавляются только после подключения безопасной проверки и хранилища.</div><button class="btn primary">Разместить услугу</button></form>`}
function chats(){shell(`<section><div class="sectionHead"><div><h2>Сообщения</h2><div class="muted">Все договорённости в одном месте</div></div></div><div class="notice">Чат работает локально в демо-режиме. После добавления ключей Supabase он может быть подключён к Realtime.</div><div class="list" style="margin-top:14px">${state.messages.length?state.messages.map((m,i)=>`<div class="listItem" onclick="chat(${i})"><div class="thumb">💬</div><div><b>${escapeHtml(m.name)}</b><div class="muted">${escapeHtml(m.items.at(-1)?.text||'Начните диалог')}</div></div><div class="spacer"></div><span>›</span></div>`).join(''):'<div class="empty panel">Нет переписок. Откройте услугу и напишите специалисту.</div>'}</div></section>`)}
function trustLabel(){if(state.trustScore>=90)return 'Эксперт «Помогай»';if(state.trustScore>=75)return 'Надёжный исполнитель';if(state.trustScore>=55)return 'Проверенный профиль';if(state.trustScore>0)return 'Базовый уровень';return 'Новый пользователь'}
function profile(){
  if(!state.session){
    shell(`<section class="panel guestProfile"><div class="welcomeAvatar"><span class="personGlyph">♙</span></div><h2>Личный кабинет</h2><p class="muted">Войдите или создайте аккаунт, чтобы управлять профилем, объявлениями и сервисами «Помогай».</p><div class="authChoice"><button class="btn primary" onclick="showAuth('login')">Войти</button><button class="btn outline" onclick="showAuth('signup')">Создать аккаунт</button></div></section>`);
    return;
  }
  const displayName=state.user.name||state.session?.user?.user_metadata?.name||state.session?.user?.email?.split('@')[0]||'Пользователь';
  shell(`<section class="panel profileSummary">
    <div class="profileIdentity"><div><h2>${escapeHtml(displayName)}</h2><div class="muted">${escapeHtml(state.user.city||'Москва')}</div><div class="badges" style="margin-top:8px"><span class="badge trustBadge">🛡️ ${trustLabel()}</span>${state.user.identity_verified?'<span class="badge verifiedBadge">✓ Личность подтверждена</span>':'<span class="badge neutral">Личность не подтверждена</span>'}</div></div></div>
    <div class="trustMeter"><div class="trustMeterHead"><b>Уровень доверия</b><strong>${state.trustScore}%</strong></div><div class="trustTrack"><i style="width:${state.trustScore}%"></i></div><small>Подтвердите email, телефон, личность и профессиональный статус, чтобы повысить уровень доверия.</small></div>
    <div class="profilePrimaryAction"><button class="btn primary" onclick="editProfile()">Редактировать профиль</button></div>
  </section>
  <section class="section profileSection profileSectionGarnet"><h2>Аккаунт</h2><div class="profileMenuGrid">
    <button class="profileMenuCard" onclick="showPlans()"><span class="profileMenuIcon">⭐</span><span><b>Тарифы</b><small>Бесплатно, PRO, Business, Premium и Inclusive</small></span><i>›</i></button>
    <button class="profileMenuCard" onclick="showBonusShop()"><span class="profileMenuIcon">💎</span><span><b>Помогай Бонусы</b><small>Баланс: ${state.bonusBalance} бонусов</small></span><i>›</i></button>
    <button class="profileMenuCard" onclick="showPromotion()"><span class="profileMenuIcon">🚀</span><span><b>Продвижение</b><small>Поднять, выделить или закрепить объявление</small></span><i>›</i></button>
  </div></section>
  <section class="section profileSection profileSectionGarnet"><h2>Доверие и проверка</h2><div class="profileMenuGrid">
    <button class="profileMenuCard" onclick="verifyIdentity()"><span class="profileMenuIcon">🪪</span><span><b>Подтверждение личности</b><small>Проверка паспорта обязательна для каждого пользователя</small></span><i>›</i></button>
    <button class="profileMenuCard" onclick="verifyProfessionalStatus()"><span class="profileMenuIcon">🏢</span><span><b>Профессиональный статус</b><small>Самозанятый, ИП, ООО или другая организация</small></span><i>›</i></button>
    <button class="profileMenuCard" onclick="showTrustLevels()"><span class="profileMenuIcon">🛡️</span><span><b>Уровни доверия</b><small>Как формируется репутация пользователя</small></span><i>›</i></button>
  </div></section>
  <section class="section profileSection profileSectionGarnet"><h2>Помощь и настройки</h2><div class="profileMenuGrid">
    <button class="profileMenuCard" onclick="showAccountSettings()"><span class="profileMenuIcon">⚙️</span><span><b>Настройки аккаунта</b><small>Уведомления, безопасность и приватность</small></span><i>›</i></button>
    <button class="profileMenuCard" onclick="showSupport()"><span class="profileMenuIcon">❓</span><span><b>Поддержка</b><small>Вопросы и помощь по работе сервиса</small></span><i>›</i></button>
  </div></section>`)
}
function setFilter(x){state.filter=x;state.page='catalog';render()} function go(p){state.page=p;window.scrollTo(0,0);render()}
function fav(id){state.fav=state.fav.includes(id)?state.fav.filter(x=>x!==id):[...state.fav,id];save();render();toast('Избранное обновлено')}
function addTask(e){e.preventDefault();const d=Object.fromEntries(new FormData(e.target));state.tasks.unshift({...d,id:Date.now()});save();e.target.reset();render();toast('Задание опубликовано')}
function addService(e){e.preventDefault();const d=Object.fromEntries(new FormData(e.target)),icon=(categories.find(x=>x[1]===d.cat)||['✨'])[0];state.services.unshift({...d,id:Date.now(),icon,name:state.user.name,rating:5,reviews:0,city:state.user.city,verified:state.user.verified,selfEmployed:d.legal==='Самозанятый',ip:d.legal==='ИП',company:d.legal==='Компания',distance:1.5,response:'15 минут',online:true});save();state.page='catalog';render();toast('Услуга опубликована')}
function modal(html){
  closeModal(true);
  document.body.classList.add('modal-open');
  document.body.insertAdjacentHTML('beforeend',`<div class="modalwrap" id="modal" onclick="if(event.target===this)closeModal()"><div class="modal" role="dialog" aria-modal="true"><div class="sheetTop"><button class="sheetbar" aria-label="Потянуть вниз, чтобы закрыть"></button><button class="sheetClose" aria-label="Закрыть" onclick="closeModal()">×</button></div>${html}</div></div>`);
  requestAnimationFrame(()=>document.querySelector('#modal')?.classList.add('open'));
  enableSheetDrag();
}
function enableSheetDrag(){
  const wrap=document.querySelector('#modal'),sheet=wrap?.querySelector('.modal'),handle=wrap?.querySelector('.sheetTop');
  if(!wrap||!sheet||!handle)return;
  let startY=0,lastY=0,dragging=false;
  const pointY=e=>e.touches?.[0]?.clientY ?? e.changedTouches?.[0]?.clientY ?? e.clientY;
  const begin=e=>{if(e.target.closest('.sheetClose'))return;dragging=true;startY=pointY(e);lastY=startY;sheet.classList.add('dragging')};
  const move=e=>{if(!dragging)return;lastY=pointY(e);const dy=Math.max(0,lastY-startY);if(dy>0)e.preventDefault();sheet.style.transform=`translateY(${dy}px)`;wrap.style.background=`rgba(17,24,39,${Math.max(.06,.5-dy/650)})`};
  const finish=()=>{if(!dragging)return;dragging=false;sheet.classList.remove('dragging');const dy=Math.max(0,lastY-startY);if(dy>70){closeModal()}else{sheet.style.transform='';wrap.style.background=''}};
  handle.addEventListener('touchstart',begin,{passive:true});
  handle.addEventListener('touchmove',move,{passive:false});
  handle.addEventListener('touchend',finish,{passive:true});
  handle.addEventListener('pointerdown',begin);
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',finish);
}
function closeModal(immediate=false){
  const wrap=document.querySelector('#modal');if(!wrap)return;
  document.body.classList.remove('modal-open');
  if(immediate){wrap.remove();return}
  wrap.classList.remove('open');wrap.classList.add('closing');
  setTimeout(()=>wrap.remove(),240);
}
function openService(id){const s=state.services.find(x=>x.id===id);modal(`<div class="cover" style="border-radius:22px">${s.icon}</div><div class="sectionHead" style="margin-top:16px"><div><h2>${escapeHtml(s.title)}</h2><div class="muted">${escapeHtml(s.name)}</div><div class="badges">${badges(s)}</div></div><b class="price">${escapeHtml(s.price)}</b></div><span class="rating">★ ${s.rating} · ${s.reviews} отзывов</span><p>${escapeHtml(s.desc)}</p><div class="panel"><b>${s.online?'● Сейчас онлайн':`Обычно отвечает за ${escapeHtml(s.response)}`}</b><div class="muted">${escapeHtml(s.city)}${s.distance!=null?` · ${s.distance} км`:''} · На сервисе более года</div></div><div class="actions"><button class="btn primary" onclick="startChat(${JSON.stringify(s.id)})">Написать</button><button class="btn outline" onclick="fav(${s.id})">${state.fav.includes(s.id)?'Убрать из избранного':'В избранное'}</button><button class="btn outline" onclick="reportUser(${s.id})">Пожаловаться</button></div>`)}
function startChat(id){const s=state.services.find(x=>x.id===id);let i=state.messages.findIndex(x=>x.serviceId===id);if(i<0){state.messages.push({serviceId:id,name:s.name,items:[{from:'them',text:'Здравствуйте! Расскажите, пожалуйста, подробнее о задаче.'}]});i=state.messages.length-1;save()}closeModal();chat(i)}
function chat(i){const c=state.messages[i];closeModal();modal(`<div class="row"><div><h2 style="margin:0">${escapeHtml(c.name)}</h2><div class="muted">Обычно отвечает быстро</div></div><button class="btn outline" onclick="closeModal()">Закрыть</button></div><div class="chat">${c.items.map(x=>`<div class="msg ${x.from==='me'?'me':''}">${escapeHtml(x.text)}</div>`).join('')}</div><form class="row" onsubmit="sendMsg(event,${i})"><input name="text" required placeholder="Сообщение" style="flex:1;border:1px solid var(--line);border-radius:14px;padding:13px"><button class="btn primary">Отправить</button></form>`)}
function sendMsg(e,i){e.preventDefault();const t=new FormData(e.target).get('text');state.messages[i].items.push({from:'me',text:t});save();chat(i);setTimeout(()=>{state.messages[i].items.push({from:'them',text:'Спасибо! Напишите удобный день и время.'});save();chat(i)},700)}
function startHelping(){if(!state.session){showAuth('signup');toast('Создайте аккаунт, чтобы предложить услугу');return}state.createMode='service';closeModal();go('create')}
function chooseRole(){modal(`<h2>Что хотите сделать?</h2><div class="roleGrid"><button class="roleCard" onclick="closeModal();state.createMode='task';go('create')"><b>Попросить помощь</b><span>Разместить задачу и получить отклики</span></button><button class="roleCard" onclick="startHelping()"><b>Предложить помощь</b><span>Опубликовать услугу и получать заказы</span></button></div>`)}
function setRole(r){state.createMode=r==='helper'?'service':'task';closeModal();go('create')}
function editProfile(){
  const currentName=state.user.name||state.session?.user?.user_metadata?.name||'';
  modal(`<h2>Редактирование профиля</h2><form class="form" onsubmit="saveProfile(event)"><div class="field"><label>Отображаемое имя</label><input name="name" required minlength="2" maxlength="80" autocomplete="nickname" value="${escapeHtml(currentName)}" placeholder="Имя или псевдоним"></div><div class="field"><label>Город</label><input name="city" required minlength="2" maxlength="120" value="${escapeHtml(state.user.city||'Москва')}"></div><div id="profileError" class="authError" hidden></div><button class="btn primary">Сохранить</button></form>`)
}
function validateProfileForm(form){
  const d=Object.fromEntries(new FormData(form));
  d.name=String(d.name||'').trim().replace(/\s+/g,' ');
  d.city=String(d.city||'').trim();
  const errorEl=form.querySelector('#profileError');
  const fail=message=>{if(errorEl){errorEl.hidden=false;errorEl.textContent=message}return null};
  if(d.name.length<2)return fail('Укажите имя или псевдоним — минимум 2 символа.');
  if(!d.city)return fail('Укажите город.');
  if(errorEl)errorEl.hidden=true;
  return d;
}
function saveProfile(e){e.preventDefault();const d=validateProfileForm(e.currentTarget);if(!d)return;state.user={...state.user,...d};save();closeModal();render();toast('Профиль обновлён')}
function verifyIdentity(){modal(`<h2>Подтверждение личности</h2><div class="notice">Проверка документов пока не подключена. Не загружайте паспорт или другие документы в эту версию приложения.</div><p class="muted">Перед запуском потребуется отдельный KYC-провайдер, закрытое хранилище и процесс ручной проверки.</p><button class="btn primary" onclick="closeModal()">Понятно</button>`)}
function verifyProfessionalStatus(){modal(`<h2>Подтверждение статуса</h2><div class="notice">Проверка профессиональных документов пока не подключена. Файлы не принимаются и статус не изменяется.</div><p class="muted">Функция станет доступна после подключения безопасной серверной проверки.</p><button class="btn primary" onclick="closeModal()">Понятно</button>`)}
function verifyProfile(){verifyIdentity()}
function showAccountSettings(){modal(`<h2>Настройки аккаунта</h2><div class="settingsList"><label class="settingRow"><span><b>Уведомления</b><small>Сообщения, отклики и обновления</small></span><input type="checkbox" checked></label><label class="settingRow"><span><b>Показывать статус онлайн</b><small>Другие пользователи увидят, что вы в сети</small></span><input type="checkbox" checked></label><button class="settingsAction" onclick="showLegal('privacy')"><span><b>Конфиденциальность</b><small>Как обрабатываются ваши данные</small></span><i>›</i></button><button class="settingsAction" onclick="toast('Смена пароля пока не подключена')"><span><b>Сменить пароль</b><small>Функция готовится к подключению</small></span><i>›</i></button></div><button class="btn danger settingsLogout" onclick="closeModal();signOut()">Выйти из аккаунта</button>`)}
function showSupport(){modal(`<h2>Поддержка</h2><div class="notice">Канал поддержки пока не подключён. Сообщения из этой формы никуда не отправляются.</div><button class="btn primary" onclick="closeModal()">Понятно</button>`)}
function showFilters(){modal(`<h2>Фильтры</h2><div class="form"><div class="field"><label>Расстояние</label><select><option>До 2 км</option><option>До 5 км</option><option>До 10 км</option><option>Онлайн</option></select></div><div class="field"><label>Статус</label><select><option>Все</option><option>Только проверенные</option><option>Самозанятые</option><option>ИП и компании</option></select></div><div class="field"><label>Сортировка</label><select><option>Рекомендуемые</option><option>Ближе ко мне</option><option>По рейтингу</option><option>Сначала дешевле</option></select></div><button class="btn primary" onclick="closeModal();toast('Фильтры применены')">Применить</button></div>`)}
const plans=[
{name:'Бесплатно',price:'0 ₽',tag:'Для всех',features:['Поиск, чат и избранное','До 5 активных объявлений','Отзывы и рейтинг']},
{name:'Помогай PRO',price:'399 ₽ / месяц',tag:'Для частных специалистов',features:['Бейдж PRO и приоритет в поиске','Статистика просмотров','2 поднятия в месяц']},
{name:'Помогай Business',price:'999 ₽ / месяц',tag:'Для ИП и компаний',features:['Всё из PRO','До 5 сотрудников и филиалы','10 поднятий в месяц']},
{name:'Помогай Premium',price:'1 499 ₽ / месяц',tag:'Для активных исполнителей',features:['Всё из Business','VIP-оформление и автоподнятие','30 поднятий в месяц']},
{name:'Помогай Inclusive',price:'2 499 ₽ / месяц',tag:'Всё включено',features:['Максимальный приоритет','Расширенная аналитика','Безлимитное продвижение']}
];
function showPro(){showPlans()}
function showPlans(){modal(`<h2>Тарифы «Помогай»</h2><p class="muted">Платите за возможности, а не за юридический статус.</p><div class="plansGrid">${plans.map((p,i)=>`<article class="planCard ${i===1?'popular':''}">${i===1?'<em>Популярный</em>':''}<h3>${p.name}</h3><div class="planTag">${p.tag}</div><b class="planPrice">${p.price}</b><ul>${p.features.map(f=>`<li>✓ ${f}</li>`).join('')}</ul><button class="btn ${i?'primary':'outline'}" onclick="toast('${i?'Оплата будет подключена через платёжного провайдера':'Бесплатный тариф уже доступен'}')">${i?'Выбрать':'Текущий тариф'}</button></article>`).join('')}</div><button class="btn outline" style="margin-top:12px" onclick="showBonusShop()">💎 Купить бонусы</button>`)}
const bonusPacks=[[99,111],[499,555],[999,1222],[2499,3222],[4999,6666]];
function showBonusShop(){modal(`<h2>💎 Помогай Бонусы</h2><div class="notice">Демонстрационный экран: реальные деньги не списываются, бонусы не имеют денежной ценности.</div><p class="muted">Демо-баланс: <b>${state.bonusBalance} бонусов</b></p><div class="bonusGrid bonusGridSingle">${bonusPacks.map(([r,b],i)=>`<button class="bonusPack ${i===2?'best':''}" onclick="buyBonusDemo(${b})"><span><strong>${b} демо-бонусов</strong><small>${r.toLocaleString('ru-RU')} ₽</small></span>${i===2?'<em>Пример</em>':''}<i>Начислить демо</i></button>`).join('')}</div>`) }
function buyBonusDemo(amount){state.bonusBalance+=amount;save();closeModal();render();toast(`Демо: начислено ${amount} бонусов`)}
const promotionItems=[['Поднять на 1 час',39],['Поднять на 3 часа',79],['Поднять на 6 часов',149],['Поднять на 12 часов',249],['Поднять на 24 часа',399],['Выделить на 7 дней',149],['Срочное объявление',149],['VIP на сутки',299],['Закрепить на 24 часа',499]];
function showPromotion(){modal(`<h2>🚀 Продвижение</h2><p class="muted">Оплачивайте рублями или бонусами.</p><div class="bonusRate">Оплата бонусами: <b>1,5 бонуса = 1 ₽</b></div><div class="promoList">${promotionItems.map(([n,r])=>`<div class="promoRow"><div><b>${n}</b><small>${Math.ceil(r*1.5)} бонусов</small></div><button class="btn outline" onclick="payPromotion(${r},'${n.replace(/'/g,"\'")}')">${r} ₽</button></div>`).join('')}</div>`) }
function payPromotion(r,name){const b=Math.ceil(r*1.5);modal(`<h2>${name}</h2><p>Выберите способ оплаты:</p><div class="actions"><button class="btn primary" onclick="toast('Оплата в рублях будет подключена позже')">${r} ₽</button><button class="btn outline" onclick="spendBonuses(${b})">${b} бонусов</button></div>`)}
function spendBonuses(amount){if(state.bonusBalance<amount)return toast('Недостаточно бонусов');state.bonusBalance-=amount;save();closeModal();render();toast('Продвижение подключено')}
function showTrustLevels(){modal(`<h2>🛡️ Уровни доверия</h2><div class="trustLevels"><div><b>📱 Базовая проверка</b><span>Телефон и email подтверждены</span></div><div><b>🔵 Проверенный профиль</b><span>Личность и документы проверены</span></div><div><b>🟣 Проверенный специалист</b><span>Подтверждён статус самозанятого, ИП или компании</span></div><div><b>⭐ Надёжный исполнитель</b><span>50+ заказов, рейтинг 4,8+ и нет серьёзных жалоб</span></div><div><b>👑 Эксперт «Помогай»</b><span>Высокая репутация и большой опыт на платформе</span></div></div><div class="notice">Уровень доверия нельзя купить. Он зависит от проверок, рейтинга и истории работы.</div>`)}
function reportUser(){modal(`<h2>Жалоба</h2><div class="notice">Отправка жалоб пока не подключена. Данные не будут отправлены или сохранены.</div><button class="btn primary" onclick="closeModal()">Понятно</button>`)}
function installHelp(){toast('Safari → Поделиться → На экран «Домой»')}
function showLegal(type){const privacy=`<h2>Конфиденциальность</h2><p>Настройки интерфейса сохраняются в браузере. Профиль, задания и сообщения не сохраняются в localStorage приложения.</p><p>Для публичного профиля достаточно имени или псевдонима. Паспортные документы, платежи и обращения эта версия не принимает.</p>`;const terms=`<h2>Правила сервиса</h2><p>Размещайте достоверные объявления, общайтесь внутри сервиса и сообщайте о подозрительных действиях. Платежи и проверка документов должны проводиться только через подключённых провайдеров.</p>`;modal(`${type==='privacy'?privacy:terms}<button class="btn outline" onclick="closeModal()">Закрыть</button>`)}

function openNearbyMap(){state.page='catalog';state.view='map';window.scrollTo(0,0);render()}
function setRadius(value){state.radius=Number(value);save();render()}
function showLocationMenu(){modal(`<h2>Геолокация</h2><p class="muted">Выберите, где искать помощь.</p><div class="accountMenuList"><button onclick="useMyLocation()">📍 <span>Использовать моё местоположение</span><b>›</b></button><button onclick="closeModal();openNearbyMap()">🗺️ <span>Показать на карте</span><b>›</b></button><button onclick="chooseCity()">🏙️ <span>Выбрать город</span><b>›</b></button><button onclick="chooseRadius()">📏 <span>Радиус поиска: ${state.radius} км</span><b>›</b></button></div>`)}
function useMyLocation(){if(!navigator.geolocation){toast('Геолокация не поддерживается');return}toast('Определяем местоположение…');navigator.geolocation.getCurrentPosition(()=>{state.locationName='Рядом';save();closeModal();openNearbyMap();toast('Местоположение определено')},()=>toast('Разрешите доступ к геолокации в Safari'))}
function chooseCity(){modal(`<h2>Выберите город</h2><div class="accountMenuList">${['Москва','Санкт-Петербург','Казань','Сочи','Екатеринбург'].map(c=>`<button onclick="state.locationName='${c}';save();closeModal();render();toast('Город: ${c}')">🏙️ <span>${c}</span><b>›</b></button>`).join('')}</div>`)}
function chooseRadius(){modal(`<h2>Радиус поиска</h2><div class="radiusBar modalRadius"><label>Показывать варианты в радиусе <b>${state.radius} км</b></label><input type="range" min="1" max="50" value="${state.radius}" oninput="state.radius=Number(this.value);this.previousElementSibling.querySelector('b').textContent=this.value+' км'"></div><button class="btn primary" onclick="save();closeModal();openNearbyMap()">Показать на карте</button>`)}

function render(){({home,catalog,create,chats,profile}[state.page]||home)();const q=document.querySelector('#q');if(q)q.addEventListener('input',e=>{state.query=e.target.value;if(state.page==='catalog')render()})}

// ===== Supabase: авторизация и облачные данные =====
const cfg=window.POMOGAY_CONFIG||{};
const sb=(window.supabase&&cfg.SUPABASE_URL&&cfg.SUPABASE_ANON_KEY)?window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{flowType:'pkce',detectSessionInUrl:false,persistSession:true,autoRefreshToken:true}}):null;
const money=v=>v==null?'По договорённости':`от ${Number(v).toLocaleString('ru-RU')} ₽`;
const numberFromText=v=>{const n=String(v||'').replace(/[^0-9.,]/g,'').replace(',','.');return n?Number(n):null};
function requireAuth(){if(state.session)return true;showAuth();toast('Сначала войдите или зарегистрируйтесь');return false}
function isNativeApp(){return !!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform())}
function getAuthRedirectUrl(){return isNativeApp()?'pomogay://auth-callback':location.origin}
function showAuth(mode='login'){modal(`<h2>${mode==='signup'?'Регистрация':'Вход'}</h2><p class="muted">${mode==='signup'?'Создайте аккаунт, чтобы находить помощь, помогать другим и общаться.':'Войдите, чтобы помогать и получать помощь.'}</p><form class="form" onsubmit="authSubmit(event,'${mode}')">${mode==='signup'?'<div class="field"><label>Отображаемое имя</label><input name="name" required minlength="2" maxlength="80" autocomplete="nickname" placeholder="Имя или псевдоним"></div>':''}<div class="field"><label>Email</label><input name="email" type="email" required autocomplete="email" inputmode="email" placeholder="name@example.com"></div><div class="field"><label>Пароль</label><input name="password" type="password" minlength="${mode==='signup'?12:1}" required autocomplete="${mode==='signup'?'new-password':'current-password'}" placeholder="${mode==='signup'?'Не менее 12 символов':'Введите пароль'}"></div><div id="authError" class="authError" hidden></div><button class="btn primary authSubmitBtn">${mode==='signup'?'Создать аккаунт':'Войти'}</button></form><button class="btn outline authSwitch" onclick="closeModal();setTimeout(()=>showAuth('${mode==='signup'?'login':'signup'}'),260)">${mode==='signup'?'У меня уже есть аккаунт':'Создать аккаунт'}</button>`) }
async function authSubmit(e,mode){
  e.preventDefault();
  const form=e.currentTarget,button=form.querySelector('.authSubmitBtn'),errorEl=form.querySelector('#authError');
  const showError=message=>{errorEl.hidden=false;errorEl.textContent=message};
  if(!sb){showError('Не удалось подключиться к сервису аккаунтов. Обновите страницу.');return}
  const d=Object.fromEntries(new FormData(form));
  button.disabled=true;button.textContent=mode==='signup'?'Создаём аккаунт…':'Входим…';errorEl.hidden=true;
  try{
    const email=String(d.email||'').trim().toLowerCase();
    let r=mode==='signup'
      ? await sb.auth.signUp({email,password:d.password,options:{data:{name:String(d.name||'').trim(),city:'Москва'},emailRedirectTo:getAuthRedirectUrl()}})
      : await sb.auth.signInWithPassword({email,password:d.password});
    if(r.error)throw r.error;
    if(mode==='signup'&&!r.data.session){showError('Аккаунт создан. Откройте письмо Supabase и подтвердите email, затем войдите.');button.textContent='Письмо отправлено';return}
    state.session=r.data.session;await ensureProfile();closeModal();render();toast(mode==='signup'?'Аккаунт создан':'Вы вошли в аккаунт');
  }catch(err){
    const raw=String(err?.message||'Ошибка авторизации');
    const friendly=raw.includes('Invalid login credentials')?'Неверный email или пароль.':raw.includes('User already registered')?'Такой email уже зарегистрирован.':raw.includes('Email not confirmed')?'Сначала подтвердите email по ссылке из письма.':'Не удалось выполнить вход. Попробуйте ещё раз.';
    showError(friendly);
  }finally{button.disabled=false;if(button.textContent!=='Письмо отправлено')button.textContent=mode==='signup'?'Создать аккаунт':'Войти'}
}
function clearPrivateSessionState(){state.user={name:'',city:'Москва',verified:false};state.tasks=[];state.messages=[];state.fav=[];state.trustScore=0;state.bonusBalance=0;save()}
async function signOut(){try{if(sb)await sb.auth.signOut()}finally{state.session=null;clearPrivateSessionState();state.page='home';render();toast('Вы вышли')}}
// Вызывается из native-bundle.js, когда приложение открыто по ссылке pomogay://auth-callback
// (пользователь подтвердил email или прошёл по magic-ссылке из письма).
window.handleAuthDeepLink=async function(url){
  if(!sb||!url)return;
  try{
    // Поддерживаем оба Supabase flow: PKCE (?code=...) и implicit (#access_token=...).
    // URL() понимает кастомную схему pomogay://, а hash разбираем отдельно.
    const parsed=new URL(url);
    const trusted=isNativeApp()
      ? parsed.protocol==='pomogay:'&&parsed.hostname==='auth-callback'
      : parsed.origin===location.origin;
    if(!trusted)throw new Error('Untrusted auth callback URL');
    const query=parsed.searchParams;
    const hash=new URLSearchParams((parsed.hash||'').replace(/^#/,''));
    const errorDescription=query.get('error_description')||hash.get('error_description');
    if(errorDescription)throw new Error(decodeURIComponent(errorDescription));

    const code=query.get('code');
    if(code){
      const {data,error}=await sb.auth.exchangeCodeForSession(code);
      if(error)throw error;
      state.session=data.session;
      await ensureProfile();
      closeModal();render();toast('Email подтверждён, вы вошли в аккаунт');
      return true;
    }

    const access_token=hash.get('access_token')||query.get('access_token');
    const refresh_token=hash.get('refresh_token')||query.get('refresh_token');
    if(access_token&&refresh_token){
      const {data,error}=await sb.auth.setSession({access_token,refresh_token});
      if(error)throw error;
      state.session=data.session;
      await ensureProfile();
      closeModal();render();toast('Email подтверждён, вы вошли в аккаунт');
      return true;
    }
    return false;
  }catch(e){
    console.warn('Auth deep link error',e);
    toast('Не удалось завершить подтверждение. Попробуйте войти вручную.');
    return false;
  }
};
async function ensureProfile(){
  if(!sb||!state.session)return;
  const u=state.session.user;
  const registeredName=String(u.user_metadata?.name||'').trim();
  let {data,error}=await sb.from('profiles').select('*').eq('id',u.id).maybeSingle();
  if(error)console.warn(error);
  if(!data){
    const row={id:u.id,name:registeredName||u.email?.split('@')[0]||'Пользователь',city:u.user_metadata?.city||'Москва'};
    const r=await sb.from('profiles').insert(row).select().single();
    if(!r.error)data=r.data;
  }else if(registeredName&&data.name==='Светлана'&&registeredName!=='Светлана'){
    const r=await sb.from('profiles').update({name:registeredName}).eq('id',u.id).select().single();
    if(!r.error)data=r.data;
  }
  if(data){
    state.user={name:data.name||registeredName||u.email?.split('@')[0]||'Пользователь',city:data.city||u.user_metadata?.city||'Москва',verified:!!data.verified,identity_verified:!!data.verified,legal_verified:false,avatar_url:data.avatar_url||null};
    state.trustScore=data.verified?55:0;
    save();
  }
}
function serviceFromRow(x){return {id:x.id,icon:(categories.find(c=>c[1]===x.category)||['✨'])[0],title:x.title,cat:x.category,name:x.profiles?.name||'Помощник',rating:Number(x.profiles?.rating||5),reviews:0,price:money(x.price_from),city:x.city||'Москва',verified:!!x.profiles?.verified,selfEmployed:x.profiles?.legal_status==='self_employed',ip:x.profiles?.legal_status==='ip',company:x.profiles?.legal_status==='company',pro:!!x.profiles?.pro_until,distance:null,response:`${x.response_minutes||60} минут`,desc:x.description,online:false,owner_id:x.owner_id}}
async function loadCloud(){if(!sb)return;try{const sr=await sb.from('services').select('*,profiles(name,rating,verified,legal_status,pro_until)').eq('is_active',true).order('created_at',{ascending:false});if(!sr.error&&sr.data?.length)state.services=[...sr.data.map(serviceFromRow),...seed];if(state.session){const uid=state.session.user.id;const tr=await sb.from('tasks').select('*').eq('customer_id',uid).order('created_at',{ascending:false});if(!tr.error)state.tasks=(tr.data||[]).map(x=>({id:x.id,title:x.title,cat:x.category,desc:x.description,budget:x.budget?`${Number(x.budget).toLocaleString('ru-RU')} ₽`:'По договорённости',city:x.address||'Москва'}));const fr=await sb.from('favorites').select('service_id').eq('user_id',uid);if(!fr.error)state.fav=(fr.data||[]).map(x=>x.service_id)}state.cloudReady=true;render()}catch(e){console.warn('Cloud load',e)}}

// Облачные версии действий.
const localAddTask=addTask,localAddService=addService,localSaveProfile=saveProfile,localFav=fav;
addTask=async function(e){e.preventDefault();if(!requireAuth())return;const d=Object.fromEntries(new FormData(e.target));const r=await sb.from('tasks').insert({customer_id:state.session.user.id,title:String(d.title).trim(),category:d.cat,description:String(d.desc).trim(),budget:numberFromText(d.budget),address:String(d.city).trim(),scheduled_at:d.date?new Date(d.date).toISOString():null,status:'open'}).select().single();if(r.error)return toast('Не удалось опубликовать задание');e.target.reset();await loadCloud();toast('Задание опубликовано')};
addService=async function(e){e.preventDefault();if(!requireAuth())return;const d=Object.fromEntries(new FormData(e.target));const r=await sb.from('services').insert({owner_id:state.session.user.id,title:String(d.title).trim(),category:d.cat,description:String(d.desc).trim(),price_from:numberFromText(d.price),city:state.user.city,response_minutes:15,is_active:true}).select().single();if(r.error)return toast('Не удалось опубликовать услугу');state.page='catalog';await loadCloud();toast('Услуга опубликована')};
fav=async function(id){if(!state.session)return localFav(id);const uid=state.session.user.id;if(state.fav.includes(id)){const r=await sb.from('favorites').delete().eq('user_id',uid).eq('service_id',id);if(r.error)return toast(r.error.message);state.fav=state.fav.filter(x=>x!==id)}else{const r=await sb.from('favorites').insert({user_id:uid,service_id:id});if(r.error)return toast(r.error.message);state.fav=[...state.fav,id]}save();render();toast('Избранное обновлено')};
saveProfile=async function(e){e.preventDefault();const d=validateProfileForm(e.currentTarget);if(!d)return;if(!state.session){state.user={...state.user,...d};save();closeModal();render();toast('Профиль обновлён');return}const r=await sb.from('profiles').update({name:d.name,city:d.city}).eq('id',state.session.user.id);if(r.error)return toast('Не удалось сохранить профиль');const authResult=await sb.auth.updateUser({data:{name:d.name,city:d.city}});if(authResult.error)return toast('Профиль сохранён частично. Обновите страницу.');state.user={...state.user,...d};save();closeModal();render();toast('Профиль обновлён')};

async function initApp(){Object.assign(window,{handleTopAvatar,showWelcomeAuth,go,setFilter,fav,openService,addTask,addService,startChat,chat,sendMsg,closeModal,installHelp,showLegal,state,render,chooseRole,setRole,editProfile,saveProfile,verifyProfile,verifyIdentity,verifyProfessionalStatus,showAccountSettings,showSupport,showFilters,showPro,showPlans,showBonusShop,showPromotion,showTrustLevels,buyBonusDemo,payPromotion,spendBonuses,reportUser,showAuth,authSubmit,signOut,showAccountMenu,startHelping,openNearbyMap,setRadius,showLocationMenu,useMyLocation,chooseCity,chooseRadius});render();if(!sb){toast('Проверьте config.js');return}const {data}=await sb.auth.getSession();state.session=data.session;
// При возврате из письма в браузере завершаем PKCE/implicit callback до загрузки данных.
if(location.search.includes('code=')||location.hash.includes('access_token=')){
  await window.handleAuthDeepLink(location.href);
  history.replaceState({},document.title,location.pathname);
}
await ensureProfile();await loadCloud();sb.auth.onAuthStateChange(async(_event,session)=>{state.session=session;if(!session)clearPrivateSessionState();await ensureProfile();await loadCloud();render()});if('serviceWorker'in navigator&&!isNativeApp())navigator.serviceWorker.register('sw.js')}
initApp();

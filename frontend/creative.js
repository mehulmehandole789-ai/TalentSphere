/* Native animation and interaction lifecycle. Visibility-aware motion with explicit pause controls. */
(()=>{
 let dispose=()=>{},userPaused=false;
 window.cleanupCreative=()=>dispose();
 window.initCreative=view=>{
  dispose();
  const removers=[],animations=[];
  const on=(target,event,fn,options)=>{if(!target)return;target.addEventListener(event,fn,options);removers.push(()=>target.removeEventListener(event,fn,options));};
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const animate=(el,frames,options)=>{if(el&&!reduced.matches&&el.animate){const a=el.animate(frames,options);animations.push(a);}};
  const motionControls=[...document.querySelectorAll('[data-motion-toggle]')];
  const syncMotion=()=>{
   const paused=userPaused||reduced.matches;
   document.body.classList.toggle('motion-paused',paused);
   motionControls.forEach(button=>{button.textContent=reduced.matches?'Reduced motion':paused?'Play motion':'Pause motion';button.setAttribute('aria-pressed',String(paused));button.disabled=reduced.matches;});
  };
  const pauseMotion=()=>{userPaused=true;syncMotion();};
  motionControls.forEach(button=>on(button,'click',()=>{userPaused=!userPaused;syncMotion();}));
  on(reduced,'change',syncMotion);syncMotion();
  document.body.classList.toggle('home-view',view==='landing');
  const header=document.querySelector('#topnav'),trigger=document.querySelector('#explore-trigger'),panel=document.querySelector('#explore-panel');
  const setMenu=open=>{if(!trigger)return;trigger.setAttribute('aria-expanded',String(open));panel.hidden=!open;if(open)animate(panel,[{opacity:0,transform:'translateY(-8px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'ease-out'});};
  on(trigger,'click',()=>setMenu(panel.hidden));
  on(trigger,'keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();setMenu(true);panel.querySelector('a').focus();}});
  on(panel,'keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const links=[...panel.querySelectorAll('a')],i=links.indexOf(document.activeElement);links[(i+(e.key==='ArrowDown'?1:-1)+links.length)%links.length].focus();}});
  on(document,'click',e=>{if(trigger&&!e.target.closest('.explore-menu'))setMenu(false);});
  on(document,'keydown',e=>{if(e.key==='Escape'&&trigger&&!panel.hidden){setMenu(false);trigger.focus();}else if(e.key==='Escape'&&document.querySelector('.navlinks.open')){document.querySelector('[data-action="togglenav"]').click();document.querySelector('[data-action="togglenav"]').focus();}});
  on(document.querySelector('.explore-menu'),'focusout',e=>{if(!e.currentTarget.contains(e.relatedTarget))setMenu(false);});
  let frame=0;
  const heroPhoto=document.querySelector('.cinematic>.hero-photo');
  const scroll=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;header?.classList.toggle('is-scrolled',scrollY>30);if(heroPhoto)heroPhoto.style.transform=reduced.matches?'':`translateY(${Math.min(scrollY*.1,65)}px)`;});};
  on(window,'scroll',scroll,{passive:true});on(reduced,'change',()=>{animations.forEach(a=>a.cancel());scroll();});scroll();
  if(view==='landing'){
   document.querySelectorAll('.hero-copy>.eyebrow,.hero-copy>h1,.hero-copy>.lead,.hero-copy>.hero-ctas').forEach((el,i)=>animate(el,[{opacity:0,transform:'translateY(20px)'},{opacity:1,transform:'translateY(0)'}],{duration:650,delay:i*90,easing:'cubic-bezier(.2,.7,.2,1)',fill:'backwards'}));
   const reveals=document.querySelectorAll('.section-head,.step,.cat-card,.community-section .artist-card,.feature-heading,.final-cta h2');
   if(!reduced.matches&&'IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){animate(entry.target,[{opacity:.2,transform:'translateY(24px)'},{opacity:1,transform:'translateY(0)'}],{duration:650,easing:'ease-out'});observer.unobserve(entry.target);}}),{threshold:.12});reveals.forEach(el=>observer.observe(el));removers.push(()=>observer.disconnect());}
  }
  const carousel=document.querySelector('.showcase'),track=document.querySelector('.showcase-track');
  if(carousel){let index=0;const cards=[...track.children],dots=[...document.querySelectorAll('[data-slide-to]')],prev=document.querySelector('[data-slide="-1"]'),next=document.querySelector('[data-slide="1"]');
   const update=()=>{const card=cards[index],offset=card.offsetLeft-(carousel.clientWidth-card.offsetWidth)/2;track.style.transform=`translateX(${-offset}px)`;cards.forEach((c,i)=>{c.classList.toggle('is-active',i===index);c.setAttribute('aria-current',String(i===index));c.querySelector('a').tabIndex=i===index?0:-1;});dots.forEach((d,i)=>d.setAttribute('aria-pressed',String(i===index)));prev.disabled=index===0;next.disabled=index===cards.length-1;document.querySelector('#slide-status').textContent=`${index+1} / ${cards.length}`;};
   let hovered=false,focused=false,visible=false;
   const go=(i,manual=true)=>{if(manual)pauseMotion();index=Math.max(0,Math.min(cards.length-1,i));document.querySelector('#slide-status').setAttribute('aria-live',manual?'polite':'off');update();};
   on(carousel,'mouseenter',()=>{hovered=true;});on(carousel,'mouseleave',()=>{hovered=false;});
   const section=carousel.closest('.showcase-section');
   on(section,'focusin',()=>{focused=true;});on(section,'focusout',e=>{focused=section.contains(e.relatedTarget);});
   if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;},{threshold:.3});observer.observe(carousel);removers.push(()=>observer.disconnect());}
   const timer=setInterval(()=>{if(cards.length>1&&visible&&!hovered&&!focused&&!document.hidden&&!userPaused&&!reduced.matches)go((index+1)%cards.length,false);},4200);
   removers.push(()=>clearInterval(timer));
   on(prev,'click',()=>go(index-1));on(next,'click',()=>go(index+1));dots.forEach((d,i)=>on(d,'click',()=>go(i)));
   on(carousel,'keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();go(index+(e.key==='ArrowRight'?1:-1));}if(e.key==='Home'){e.preventDefault();go(0);}if(e.key==='End'){e.preventDefault();go(cards.length-1);}});
   let touch=null;on(carousel,'touchstart',e=>{touch={x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});on(carousel,'touchend',e=>{if(!touch)return;const dx=e.changedTouches[0].clientX-touch.x,dy=e.changedTouches[0].clientY-touch.y;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy))go(index+(dx<0?1:-1));touch=null;},{passive:true});
   on(window,'resize',update);update();
  }
  if(heroPhoto&&'IntersectionObserver' in window){const heroObserver=new IntersectionObserver(entries=>{heroPhoto.classList.toggle('motion-offscreen',!entries[0].isIntersecting);});heroObserver.observe(heroPhoto);removers.push(()=>heroObserver.disconnect());}
  const tabs=[...document.querySelectorAll('[data-feature]')],feature=document.querySelector('#feature-panel');
  if(feature){const content=[{image:'concert',alt:'An audience sharing a live music experience',title:'Find the talent that feels like you.',text:'From intimate acoustic sets to a full stage production. Explore artist portfolios, disciplines, locations, and pricing to find your creative match.',view:'explore',cta:'Discover artists'},{image:'performance',alt:'Stage lighting at a creative performance',title:'Different talents. A shared vision.',text:'Find a creative partner for your next project. Explore the community and send a collaboration proposal with your idea, timeline, and budget.',view:'collaborate',cta:'Find collaborators'},{image:'wedding',alt:'An event space prepared for a celebration',title:'Make the occasion unforgettable.',text:'Share your event details with an artist. Review their response and final quote, then confirm your accepted booking through secure payment.',view:'explore',cta:'Find talent to book'}];
   const select=i=>{tabs.forEach((tab,n)=>{tab.setAttribute('aria-selected',String(i===n));tab.tabIndex=i===n?0:-1;});feature.setAttribute('aria-labelledby',`feature-tab-${i}`);const c=content[i];feature.innerHTML=`<img src="/assets/events/${c.image}.jpg" alt="${c.alt}" width="900" height="600" loading="lazy"><div><h3>${c.title}</h3><p>${c.text}</p><a href="#${c.view}" class="btn btn-outline-ink" data-action="nav" data-view="${c.view}">${c.cta} &#8599;</a></div>`;animate(feature,[{opacity:.3,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0)'}],{duration:320,easing:'ease-out'});};
   tabs.forEach((tab,i)=>{on(tab,'click',()=>select(i));on(tab,'keydown',e=>{let n;if(e.key==='ArrowRight')n=(i+1)%tabs.length;if(e.key==='ArrowLeft')n=(i+tabs.length-1)%tabs.length;if(e.key==='Home')n=0;if(e.key==='End')n=tabs.length-1;if(n!==undefined){e.preventDefault();tabs[n].focus();select(n);}});});select(0);
  }
  dispose=()=>{removers.forEach(fn=>fn());animations.forEach(a=>a.cancel());cancelAnimationFrame(frame);};
 };
})();

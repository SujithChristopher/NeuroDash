// @ts-nocheck
/* ============================================================
   MINI-CHART — a zero-dependency canvas chart engine
   Implements just enough of the Chart.js v4 API surface that this
   app's mkChart()/lineChart()/barChart()/donutChart() helpers use
   (line, bar, doughnut; fill, dashed lines, horizontal bars, basic
   legend, hover tooltips). Bundled inline so NeuroDash never depends
   on an external CDN or internet access to render its graphs.
   ============================================================ */

"use strict";

function escHtml(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

function hexToRgba(hex, alpha){
  hex = (hex||'').trim();
  if(hex.charAt(0)!=='#') return hex;
  var c = hex.slice(1);
  if(c.length===3) c = c.split('').map(function(ch){ return ch+ch; }).join('');
  var r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16);
  return 'rgba('+r+','+g+','+b+','+alpha+')';
}

function shade(hex, percent){
  if(!hex || hex.charAt(0)!=='#') return hex;
  var c = hex.slice(1); if(c.length===3) c = c.split('').map(function(ch){ return ch+ch; }).join('');
  var r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16);
  var amt = Math.round(2.55*percent);
  r = Math.min(255,Math.max(0,r+amt)); g = Math.min(255,Math.max(0,g+amt)); b = Math.min(255,Math.max(0,b+amt));
  return 'rgb('+r+','+g+','+b+')';
}

function niceStep(rawStep){
  if(rawStep<=0) return 1;
  var mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  var norm = rawStep/mag;
  var step;
  if(norm<1.5) step=1; else if(norm<3) step=2; else if(norm<7) step=5; else step=10;
  return step*mag;
}

function computeYAxis(dataMax, suggestedMax){
  var max = Math.max(dataMax||0, suggestedMax||0);
  if(max<=0) max = 1;
  var step = niceStep(max/4);
  var niceMax = Math.ceil(max/step)*step;
  var ticks = [];
  for(var v=0; v<=niceMax+1e-9; v+=step) ticks.push(Math.round(v*1000)/1000);
  return { max: niceMax, ticks: ticks };
}

function roundRectTop(ctx,x,y,w,h,r){
  ctx.beginPath();
  if(w<=0 || h<=0) return;
  var rr = Math.max(0,Math.min(r, w/2, h));
  ctx.moveTo(x, y+h);
  ctx.lineTo(x, y+rr);
  ctx.arcTo(x,y,x+rr,y,rr);
  ctx.lineTo(x+w-rr,y);
  ctx.arcTo(x+w,y,x+w,y+rr,rr);
  ctx.lineTo(x+w,y+h);
  ctx.closePath();
}

function roundRectRight(ctx,x,y,w,h,r){
  ctx.beginPath();
  if(w<=0 || h<=0) return;
  var rr = Math.max(0,Math.min(r, h/2, w));
  ctx.moveTo(x,y);
  ctx.lineTo(x+w-rr,y);
  ctx.arcTo(x+w,y,x+w,y+rr,rr);
  ctx.lineTo(x+w,y+h-rr);
  ctx.arcTo(x+w,y+h,x+w-rr,y+h,rr);
  ctx.lineTo(x,y+h);
  ctx.closePath();
}

function easeOutCubic(t){ return 1-Math.pow(1-t,3); }

function MiniChart(ctx, config){
  this.ctx = ctx;
  this.canvas = ctx.canvas;
  this.config = config || {};
  this.type = this.config.type;
  this.data = this.config.data || {};
  this.o = this.config.options || {};
  this._hoverIdx = null;
  this._hoverArc = null;
  this._buildTooltip();
  this._onMove = this._onMove.bind(this);
  this._onLeave = this._onLeave.bind(this);
  this.canvas.addEventListener('mousemove', this._onMove);
  this.canvas.addEventListener('mouseleave', this._onLeave);
  var self = this;
  if(window.ResizeObserver){
    this._ro = new ResizeObserver(function(){ self._resize(); });
    this._ro.observe(this.canvas.parentElement||this.canvas);
  } else {
    this._winResize = function(){ self._resize(); };
    window.addEventListener('resize', this._winResize);
  }
  this._prepareAnim();
  this._resize();
  this._startAnim();
}

// ---- Animation: progress _t runs 0→1 linearly; each chart type applies its own easing.
MiniChart.prototype._prepareAnim = function(){
  var a = this.o.animation;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dur = (a===false || reduce) ? 0 : ((a && a.duration) || (this.type==='doughnut' ? 900 : this.type==='bar' ? 650 : 1000));
  this._animDur = dur;
  this._t = dur ? 0 : 1;
};

MiniChart.prototype._startAnim = function(){
  if(!this._animDur) return;
  var self = this, t0 = null;
  function frame(ts){
    if(self._destroyed) return;
    if(t0===null) t0 = ts;
    self._t = Math.min(1, (ts-t0)/self._animDur);
    self._draw();
    if(self._t<1) self._raf = requestAnimationFrame(frame);
  }
  this._raf = requestAnimationFrame(frame);
};

// Smooth path through points (monotone cubic: curves never overshoot the data), or straight segments.
MiniChart.prototype._trace = function(pts, tension){
  var ctx = this.ctx, n = pts.length, i;
  ctx.moveTo(pts[0].x, pts[0].y);
  if(!(tension>0) || n<3){ for(i=1;i<n;i++) ctx.lineTo(pts[i].x, pts[i].y); return; }
  var d=[], m=[];
  for(i=0;i<n-1;i++){ var dx0=pts[i+1].x-pts[i].x; d.push(dx0 ? (pts[i+1].y-pts[i].y)/dx0 : 0); }
  m[0]=d[0]; m[n-1]=d[n-2];
  for(i=1;i<n-1;i++) m[i] = (d[i-1]*d[i] <= 0) ? 0 : (d[i-1]+d[i])/2;
  for(i=0;i<n-1;i++){
    if(d[i]===0){ m[i]=0; m[i+1]=0; continue; }
    var a=m[i]/d[i], b=m[i+1]/d[i], h=a*a+b*b;
    if(h>9){ var k=3/Math.sqrt(h); m[i]=k*a*d[i]; m[i+1]=k*b*d[i]; }
  }
  for(i=0;i<n-1;i++){
    var x0=pts[i].x, y0=pts[i].y, x1=pts[i+1].x, y1=pts[i+1].y, dx=(x1-x0)/3;
    ctx.bezierCurveTo(x0+dx, y0+m[i]*dx, x1-dx, y1-m[i+1]*dx, x1, y1);
  }
};

// Per-bar progress with a slight stagger so bars rise in sequence rather than all at once.
MiniChart.prototype._barProg = function(i, n){
  var t = this._t==null ? 1 : this._t;
  if(t>=1) return 1;
  var lag = 0.35*i/Math.max(1,n);
  var q = (t-lag)/(1-0.35);
  return q<=0 ? 0 : easeOutCubic(Math.min(1,q));
};

MiniChart.prototype._buildTooltip = function(){
  var tt = (this.o.plugins && this.o.plugins.tooltip) || {};
  var el = document.createElement('div');
  el.className = 'mini-chart-tooltip';
  var st = el.style;
  st.position='fixed'; st.left='0'; st.top='0'; st.pointerEvents='none'; st.zIndex=9999; st.display='none';
  st.background = tt.backgroundColor || '#14201f';
  st.color = tt.bodyColor || '#fff';
  st.padding='8px 11px'; st.borderRadius='8px';
  st.fontFamily='IBM Plex Sans, system-ui, sans-serif'; st.fontSize='12px';
  st.maxWidth='240px'; st.boxShadow='0 10px 24px rgba(10,20,20,.25)'; st.lineHeight='1.55';
  document.body.appendChild(el);
  this._tip = el;
};

MiniChart.prototype.destroy = function(){
  this._destroyed = true;
  if(this._raf) cancelAnimationFrame(this._raf);
  if(this._ro) this._ro.disconnect();
  if(this._winResize) window.removeEventListener('resize', this._winResize);
  this.canvas.removeEventListener('mousemove', this._onMove);
  this.canvas.removeEventListener('mouseleave', this._onLeave);
  if(this._tip && this._tip.parentNode) this._tip.parentNode.removeChild(this._tip);
};

MiniChart.prototype._resize = function(){
  var parent = this.canvas.parentElement;
  var rect = (parent||this.canvas).getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  var w = Math.max(40, Math.floor(rect.width));
  var h = Math.max(40, Math.floor(rect.height || this.canvas.clientHeight || 200));
  this.canvas.width = Math.round(w*dpr);
  this.canvas.height = Math.round(h*dpr);
  this.canvas.style.width = w+'px';
  this.canvas.style.height = h+'px';
  this.ctx.setTransform(dpr,0,0,dpr,0,0);
  this.w = w; this.h = h;
  this._layout();
  this._draw();
};

MiniChart.prototype._legendOn = function(){ return !!(this.o.plugins && this.o.plugins.legend && this.o.plugins.legend.display); };

MiniChart.prototype._layout = function(){
  var legendH = this._legendOn() ? 26 : 0;
  if(this.type==='doughnut'){
    this.plot = { x:8, y:8+legendH, w:this.w-16, h:this.h-16-legendH };
    return;
  }
  var horizontal = this.o.indexAxis==='y';
  var padLeft = horizontal ? 76 : 34;
  var padBottom = 24;
  var padTop = 10 + legendH;
  var padRight = 12;
  this.plot = { x: padLeft, y: padTop, w: Math.max(10, this.w-padLeft-padRight), h: Math.max(10, this.h-padTop-padBottom) };
};

MiniChart.prototype._draw = function(){
  var ctx = this.ctx;
  ctx.clearRect(0,0,this.w,this.h);
  if(this._legendOn()) this._drawLegend();
  if(this.type==='line') this._drawLine();
  else if(this.type==='bar') this._drawBar();
  else if(this.type==='doughnut') this._drawDoughnut();
};

MiniChart.prototype._drawLegend = function(){
  var ctx = this.ctx;
  var datasets = this.data.datasets||[];
  ctx.font = '600 11px IBM Plex Sans, system-ui, sans-serif';
  var x = this.plot ? this.plot.x : 10;
  var y = 14;
  datasets.forEach(function(ds){
    var color = ds.borderColor || ds.backgroundColor || '#888';
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x+4, y, 4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#4b4a46';
    var label = ds.label||'';
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.fillText(label, x+12, y+1);
    x += 12 + ctx.measureText(label).width + 20;
  });
};

MiniChart.prototype._xTickStep = function(n){
  var s = this.o.scales, maxTicks = (s && s.x && s.x.ticks && s.x.ticks.maxTicksLimit) || 8;
  return Math.max(1, Math.ceil(n/maxTicks));
};

MiniChart.prototype._dataMax = function(datasets){
  var m = 0;
  datasets.forEach(function(ds){ (ds.data||[]).forEach(function(v){ if(typeof v==='number' && isFinite(v)) m=Math.max(m,v); }); });
  return m;
};

MiniChart.prototype._drawLine = function(){
  var ctx=this.ctx, p=this.plot;
  var labels = this.data.labels||[];
  var datasets = this.data.datasets||[];
  var s = this.o.scales||{};
  var suggestedMax = s.y && s.y.suggestedMax;
  var yAxis = computeYAxis(this._dataMax(datasets), suggestedMax);
  var showYGrid = !(s.y && s.y.grid && s.y.grid.display===false);
  var gridColor = (s.y && s.y.grid && s.y.grid.color) || '#e6e5df';
  var tickColor = (s.y && s.y.ticks && s.y.ticks.color) || '#8a8983';
  var n = labels.length;
  var stepX = n>1 ? p.w/(n-1) : 0;
  var xAt = function(i){ return n>1 ? p.x + i*stepX : p.x + p.w/2; };
  var yAt = function(v){ return p.y + p.h - (v/(yAxis.max||1)) * p.h; };

  ctx.textAlign='right'; ctx.textBaseline='middle';
  ctx.font='11px IBM Plex Sans, system-ui, sans-serif';
  yAxis.ticks.forEach(function(t){
    var ty = yAt(t);
    if(showYGrid){ ctx.strokeStyle=gridColor; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(p.x, ty+0.5); ctx.lineTo(p.x+p.w, ty+0.5); ctx.stroke(); }
    ctx.fillStyle = tickColor;
    ctx.fillText(String(Math.round(t*10)/10), p.x-8, ty);
  });
  ctx.strokeStyle = gridColor; ctx.beginPath(); ctx.moveTo(p.x, p.y+p.h+0.5); ctx.lineTo(p.x+p.w, p.y+p.h+0.5); ctx.stroke();

  var step = this._xTickStep(n);
  ctx.textAlign='center'; ctx.textBaseline='top';
  var self_w = this.w;
  labels.forEach(function(lb,i){
    if(i%step!==0 && i!==n-1) return;
    ctx.fillStyle = tickColor;
    var text = String(lb), tx = xAt(i), half = ctx.measureText(text).width/2;
    // Keep edge labels inside the canvas instead of letting them clip ("Day 34" → "Day 3").
    if(tx+half > self_w-2){ ctx.textAlign='right'; tx = self_w-2; }
    else if(tx-half < 2){ ctx.textAlign='left'; tx = 2; }
    else ctx.textAlign='center';
    ctx.fillText(text, tx, p.y+p.h+7);
  });
  ctx.textAlign='center';

  var self = this;
  var reveal = easeOutCubic(this._t==null ? 1 : this._t);
  ctx.save();
  if(reveal<1){ ctx.beginPath(); ctx.rect(p.x-10, p.y-10, (p.w+24)*reveal, p.h+20); ctx.clip(); } // draw the line in left → right

  datasets.forEach(function(ds){
    if(!ds.fill) return;
    var pts = (ds.data||[]).map(function(v,i){ return v==null? null : {x:xAt(i), y:yAt(v)}; }).filter(Boolean);
    if(!pts.length) return;
    ctx.beginPath();
    self._trace(pts, ds.tension);
    ctx.lineTo(pts[pts.length-1].x, p.y+p.h);
    ctx.lineTo(pts[0].x, p.y+p.h);
    ctx.closePath();
    // Soft vertical gradient: strongest under the line, fading to transparent at the axis.
    // The fill also fades in (smoothstep), starting a little after the line so the curve leads and the colour follows.
    var lin = self._t==null ? 1 : self._t;
    var f = Math.min(1, Math.max(0, (lin-0.2)/0.8));
    var fade = f*f*(3-2*f);
    var grad = ctx.createLinearGradient(0, p.y, 0, p.y+p.h);
    grad.addColorStop(0, hexToRgba(ds.borderColor||'#2a78d6', 0.32*fade));
    grad.addColorStop(1, hexToRgba(ds.borderColor||'#2a78d6', 0.02*fade));
    ctx.fillStyle = grad;
    ctx.fill();
  });
  datasets.forEach(function(ds){
    var pts = (ds.data||[]).map(function(v,i){ return v==null? null : {x:xAt(i), y:yAt(v)}; });
    ctx.beginPath();
    ctx.strokeStyle = ds.borderColor || '#2a78d6';
    ctx.lineWidth = ds.borderWidth || 2;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if(ds.borderDash && ds.borderDash.length) ctx.setLineDash(ds.borderDash); else ctx.setLineDash([]);
    var run = [];
    var flush = function(){ if(run.length) self._trace(run, ds.tension); run = []; };
    pts.forEach(function(pt){ if(!pt) flush(); else run.push(pt); });
    flush();
    ctx.stroke();
    ctx.setLineDash([]);
    if(n<=40){
      pts.forEach(function(pt){
        if(!pt) return;
        ctx.beginPath();
        ctx.fillStyle = ds.borderColor || '#2a78d6';
        ctx.arc(pt.x, pt.y, 3, 0, Math.PI*2);
        ctx.fill();
      });
    }
  });
  ctx.restore();

  if(this._hoverIdx!=null && this._hoverIdx>=0 && this._hoverIdx<n){
    var hx = xAt(this._hoverIdx);
    ctx.strokeStyle = 'rgba(120,120,115,.35)'; ctx.lineWidth=1; ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(hx, p.y); ctx.lineTo(hx, p.y+p.h); ctx.stroke();
    ctx.setLineDash([]);
  }

  this._lineGeom = { xAt: xAt, n: n, labels: labels, datasets: datasets };
};

MiniChart.prototype._drawBar = function(){
  var ctx=this.ctx, p=this.plot;
  var labels = this.data.labels||[];
  var datasets = this.data.datasets||[];
  var horizontal = this.o.indexAxis==='y';
  var gridColor = '#e6e5df', tickColor='#8a8983';
  var n = labels.length;
  var dsCount = datasets.length || 1;
  // Stacked bars (vertical only): each category is one bar made of one segment per dataset, e.g. minutes per device.
  var stacked = !!this.o.stacked && !horizontal;
  var yAxis = computeYAxis(stacked ? this._stackMax(datasets, n) : this._dataMax(datasets), undefined);
  this._barRects = [];
  var self = this;

  if(stacked){
    ctx.textAlign='right'; ctx.textBaseline='middle'; ctx.font='11px IBM Plex Sans, system-ui, sans-serif';
    yAxis.ticks.forEach(function(t){
      var ty = p.y + p.h - (t/(yAxis.max||1))*p.h;
      ctx.strokeStyle=gridColor; ctx.beginPath(); ctx.moveTo(p.x, ty+0.5); ctx.lineTo(p.x+p.w, ty+0.5); ctx.stroke();
      ctx.fillStyle=tickColor; ctx.fillText(String(Math.round(t*10)/10), p.x-8, ty);
    });
    ctx.strokeStyle=gridColor; ctx.beginPath(); ctx.moveTo(p.x,p.y+p.h+0.5); ctx.lineTo(p.x+p.w,p.y+p.h+0.5); ctx.stroke();

    var sCatW = n>0 ? p.w/n : p.w;
    var sThick = (datasets[0]&&datasets[0].maxBarThickness) || 28;
    var sBarW = Math.min(sThick, sCatW*0.7);
    var sStep = this._xTickStep(n);
    var scale = p.h/(yAxis.max||1);
    ctx.textAlign='center'; ctx.textBaseline='top';
    labels.forEach(function(lb,i){
      var cx = p.x + sCatW*i + sCatW/2;
      if(i%sStep===0 || i===n-1){ ctx.fillStyle=tickColor; ctx.fillText(String(lb).length>10?String(lb).slice(0,9)+'…':String(lb), cx, p.y+p.h+7); }
      var bx = cx - sBarW/2, w = Math.max(1, sBarW-2);
      var prog = self._barProg(i, n);
      var topDs = -1;
      datasets.forEach(function(ds,di){ if(((ds.data||[])[i]||0)>0) topDs = di; });
      var acc = 0;
      datasets.forEach(function(ds,di){
        var v = (ds.data||[])[i]||0;
        if(v<=0) return;
        var segH = v*scale;
        // Full-size geometry is kept for hover; the drawn segment grows from the baseline with the animation.
        self._barRects.push({x:bx, y:p.y+p.h-(acc+v)*scale, w:w, h:Math.max(segH,1), i:i, v:v, ds:ds, stack:true});
        var drawH = segH*prog;
        var drawY = p.y+p.h-(acc*scale)*prog-drawH;
        ctx.fillStyle = (i===self._hoverIdx) ? shade(ds.backgroundColor,-10) : (ds.backgroundColor||'#2a78d6');
        if(di===topDs) roundRectTop(ctx, bx, drawY, w, drawH, ds.borderRadius||4);
        else { ctx.beginPath(); ctx.rect(bx, drawY, w, drawH); }
        ctx.fill();
        if(di!==topDs && drawH>1){ ctx.strokeStyle='#ffffff'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(bx, drawY+0.5); ctx.lineTo(bx+w, drawY+0.5); ctx.stroke(); }
        acc += v;
      });
    });
  } else if(!horizontal){
    ctx.textAlign='right'; ctx.textBaseline='middle'; ctx.font='11px IBM Plex Sans, system-ui, sans-serif';
    yAxis.ticks.forEach(function(t){
      var ty = p.y + p.h - (t/(yAxis.max||1))*p.h;
      ctx.strokeStyle=gridColor; ctx.beginPath(); ctx.moveTo(p.x, ty+0.5); ctx.lineTo(p.x+p.w, ty+0.5); ctx.stroke();
      ctx.fillStyle=tickColor; ctx.fillText(String(Math.round(t*10)/10), p.x-8, ty);
    });
    ctx.strokeStyle=gridColor; ctx.beginPath(); ctx.moveTo(p.x,p.y+p.h+0.5); ctx.lineTo(p.x+p.w,p.y+p.h+0.5); ctx.stroke();

    var catW = n>0 ? p.w/n : p.w;
    var maxThick = (datasets[0]&&datasets[0].maxBarThickness) || 28;
    var groupW = Math.min(catW*0.62, maxThick*dsCount+dsCount*3);
    var barW = Math.min(maxThick, groupW/dsCount);
    var step = this._xTickStep(n);
    ctx.textAlign='center'; ctx.textBaseline='top';
    labels.forEach(function(lb,i){
      var cx = p.x + catW*i + catW/2;
      if(i%step===0 || i===n-1){ ctx.fillStyle=tickColor; ctx.fillText(String(lb).length>10?String(lb).slice(0,9)+'…':String(lb), cx, p.y+p.h+7); }
      datasets.forEach(function(ds,di){
        var v = (ds.data||[])[i]||0;
        var bh = (v/(yAxis.max||1))*p.h;
        var bx = cx - groupW/2 + di*barW;
        var by = p.y+p.h-bh;
        var abh = bh*self._barProg(i, n); // animated height; hover geometry below stays at full size
        ctx.fillStyle = (i===self._hoverIdx) ? shade(ds.backgroundColor,-10) : (ds.backgroundColor||'#2a78d6');
        roundRectTop(ctx, bx, p.y+p.h-abh, barW-2, abh, ds.borderRadius||4);
        ctx.fill();
        self._barRects.push({x:bx,y:by,w:barW-2,h:Math.max(bh,1),i:i,v:v,ds:ds});
      });
    });
  } else {
    ctx.textAlign='right'; ctx.textBaseline='middle'; ctx.font='11px IBM Plex Sans, system-ui, sans-serif';
    var rowH = n>0? p.h/n : p.h;
    var barH = Math.min(rowH*0.55, (datasets[0]&&datasets[0].maxBarThickness)||18);
    labels.forEach(function(lb,i){
      var cy = p.y + rowH*i + rowH/2;
      ctx.fillStyle=tickColor;
      var label = String(lb).length>14? String(lb).slice(0,13)+'…' : String(lb);
      ctx.fillText(label, p.x-8, cy);
      datasets.forEach(function(ds){
        var v = (ds.data||[])[i]||0;
        var bw = (v/(yAxis.max||1))*p.w;
        var by = cy-barH/2;
        ctx.fillStyle = (i===self._hoverIdx) ? shade(ds.backgroundColor,-10) : (ds.backgroundColor||'#2a78d6');
        roundRectRight(ctx, p.x, by, bw*self._barProg(i, n), barH, ds.borderRadius||4);
        ctx.fill();
        self._barRects.push({x:p.x,y:by,w:Math.max(bw,1),h:barH,i:i,v:v,ds:ds});
      });
    });
    ctx.strokeStyle=gridColor;
    yAxis.ticks.forEach(function(t){
      var tx = p.x + (t/(yAxis.max||1))*p.w;
      ctx.beginPath(); ctx.moveTo(tx+0.5,p.y); ctx.lineTo(tx+0.5,p.y+p.h); ctx.stroke();
    });
  }
  this._barGeom = { horizontal: horizontal, n: n, labels: labels, datasets: datasets, yAxis: yAxis };
};

MiniChart.prototype._stackMax = function(datasets, n){
  var m = 0;
  for(var i=0;i<n;i++){
    var sum = 0;
    datasets.forEach(function(ds){ var v=(ds.data||[])[i]; if(typeof v==='number' && isFinite(v) && v>0) sum+=v; });
    m = Math.max(m, sum);
  }
  return m;
};

MiniChart.prototype._drawDoughnut = function(){
  var ctx=this.ctx, p=this.plot;
  var ds = (this.data.datasets||[])[0] || {data:[],backgroundColor:[]};
  var data = ds.data||[];
  var colors = ds.backgroundColor||[];
  var total = data.reduce(function(a,b){ return a+(b||0); },0);
  var cx = p.x+p.w/2, cy = p.y+p.h/2;
  var r = Math.min(p.w,p.h)/2 - 4;
  var cutoutPct = parseFloat(this.o.cutout || '68%')/100;
  var innerR = r*cutoutPct;
  var start = -Math.PI/2;
  this._arcs=[];
  if(total<=0){
    ctx.beginPath(); ctx.strokeStyle='#e6e5df'; ctx.lineWidth=Math.max(2,r-innerR); ctx.arc(cx,cy,(r+innerR)/2,0,Math.PI*2); ctx.stroke();
    return;
  }
  var self = this;
  // Sweep clockwise from 12 o'clock: arcs are clipped to the angle reached so far.
  var limit = start + Math.PI*2*easeOutCubic(this._t==null ? 1 : this._t);
  data.forEach(function(v,i){
    var frac = (v||0)/total;
    var end = start + frac*Math.PI*2;
    var hovered = self._hoverArc===i;
    var rr = hovered? r+3 : r;
    var drawEnd = Math.min(end, limit);
    if(drawEnd<=start+0.0001){ self._arcs.push({start:start,end:end,i:i,v:v}); start = end; return; }
    ctx.beginPath();
    ctx.moveTo(cx+Math.cos(start)*innerR, cy+Math.sin(start)*innerR);
    ctx.arc(cx,cy,rr,start,drawEnd);
    ctx.arc(cx,cy,innerR,drawEnd,start,true);
    ctx.closePath();
    ctx.fillStyle = colors[i]||'#2a78d6';
    ctx.fill();
    if(ds.borderWidth){ ctx.lineWidth=ds.borderWidth; ctx.strokeStyle = ds.borderColor||'#fff'; ctx.stroke(); }
    self._arcs.push({start:start,end:end,i:i,v:v});
    start = end;
  });
};

MiniChart.prototype._tipRowsHTML = function(rows, title){
  var html = '';
  if(title) html += '<div style="font-family:IBM Plex Mono,monospace;font-size:11px;opacity:.85;margin-bottom:4px">'+escHtml(title)+'</div>';
  rows.forEach(function(r){
    html += '<div style="display:flex;align-items:center;gap:6px;white-space:nowrap">'+(r.color? '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:'+r.color+'"></span>':'')+'<span>'+escHtml(r.text)+'</span></div>';
  });
  return html;
};

MiniChart.prototype._showTip = function(x,y,html){
  this._tip.innerHTML = html;
  this._tip.style.display='block';
  var pad=14;
  var left = x+pad, top = y+pad;
  var tw = this._tip.offsetWidth, th=this._tip.offsetHeight;
  if(left+tw > window.innerWidth-8) left = x-tw-pad;
  if(top+th > window.innerHeight-8) top = y-th-pad;
  this._tip.style.left = left+'px';
  this._tip.style.top = top+'px';
};

MiniChart.prototype._hideTip = function(){ this._tip.style.display='none'; };

MiniChart.prototype._onMove = function(e){
  var rect = this.canvas.getBoundingClientRect();
  var mx = e.clientX-rect.left, my = e.clientY-rect.top;
  if(this.type==='line') this._hoverLine(mx,my,e);
  else if(this.type==='bar') this._hoverBar(mx,my,e);
  else if(this.type==='doughnut') this._hoverDoughnut(mx,my,e);
};

MiniChart.prototype._onLeave = function(){
  this._hoverIdx=null; this._hoverArc=null;
  this._hideTip();
  this._draw();
};

MiniChart.prototype._hoverLine = function(mx,my,e){
  var g=this._lineGeom; if(!g || g.n===0) return;
  var p=this.plot;
  if(mx<p.x-10 || mx>p.x+p.w+10 || my<p.y-10 || my>p.y+p.h+20){ this._hoverIdx=null; this._hideTip(); this._draw(); return; }
  var stepX = g.n>1? p.w/(g.n-1) : 0;
  var idx = stepX? Math.round((mx-p.x)/stepX) : 0;
  idx = Math.max(0, Math.min(g.n-1, idx));
  this._hoverIdx = idx;
  var callbacks = (this.o.plugins && this.o.plugins.tooltip && this.o.plugins.tooltip.callbacks) || {};
  var rows = g.datasets.map(function(ds){
    var v = (ds.data||[])[idx];
    var text;
    if(callbacks.label){
      try{ text = callbacks.label({parsed:{y:v,x:idx}, label:String(g.labels[idx]), dataset:{label:ds.label}, raw:v}); }
      catch(err){ text = (ds.label||'')+': '+v; }
    } else {
      text = (ds.label? ds.label+': ':'')+(v==null?'–':v);
    }
    return { color: ds.borderColor, text: text };
  });
  this._showTip(e.clientX, e.clientY, this._tipRowsHTML(rows, String(g.labels[idx])));
  this._draw();
};

MiniChart.prototype._hoverBar = function(mx,my,e){
  var rects=this._barRects||[];
  var hit=null;
  for(var i=0;i<rects.length;i++){ var r=rects[i]; if(mx>=r.x && mx<=r.x+r.w && my>=r.y && my<=r.y+r.h){ hit=r; break; } }
  if(!hit){ this._hoverIdx=null; this._hideTip(); this._draw(); return; }
  this._hoverIdx = hit.i;
  var label = (this._barGeom.labels||[])[hit.i];
  var suffix = this.o.valueSuffix || '';
  var fmt = function(v){ return String(Math.round(v*10)/10)+suffix; };
  if(hit.stack){
    // Stacked bar: list every segment of the hovered day, then the total.
    var rows = [], total = 0;
    (this._barGeom.datasets||[]).forEach(function(ds){
      var v = (ds.data||[])[hit.i]||0;
      if(v>0){ rows.push({color:ds.backgroundColor, text:(ds.label? ds.label+': ':'')+fmt(v)}); total += v; }
    });
    if(rows.length>1) rows.push({text:'Total: '+fmt(total)});
    this._showTip(e.clientX, e.clientY, this._tipRowsHTML(rows, String(label)));
  } else {
    var text = (hit.ds.label? hit.ds.label+': ':'')+fmt(hit.v);
    this._showTip(e.clientX, e.clientY, this._tipRowsHTML([{color:hit.ds.backgroundColor,text:text}], String(label)));
  }
  this._draw();
};

MiniChart.prototype._hoverDoughnut = function(mx,my,e){
  var p=this.plot;
  var cx=p.x+p.w/2, cy=p.y+p.h/2;
  var dx=mx-cx, dy=my-cy;
  var dist = Math.sqrt(dx*dx+dy*dy);
  var r = Math.min(p.w,p.h)/2-4;
  var cutoutPct = parseFloat(this.o.cutout||'68%')/100;
  var innerR = r*cutoutPct;
  if(dist<innerR-2 || dist>r+6){ this._hoverArc=null; this._hideTip(); this._draw(); return; }
  var ang = Math.atan2(dy,dx);
  if(ang < -Math.PI/2) ang += Math.PI*2;
  var arc = null;
  (this._arcs||[]).forEach(function(a){ if(ang>=a.start && ang<=a.end) arc=a; });
  if(!arc){ this._hoverArc=null; this._hideTip(); this._draw(); return; }
  this._hoverArc = arc.i;
  var ds = (this.data.datasets||[])[0]||{};
  var labels = this.data.labels||[];
  var total = (ds.data||[]).reduce(function(a,b){ return a+(b||0); },0);
  var pct = total? Math.round(arc.v/total*100) : 0;
  var text = (labels[arc.i]||'')+': '+arc.v+' ('+pct+'%)';
  this._showTip(e.clientX, e.clientY, this._tipRowsHTML([{color:(ds.backgroundColor||[])[arc.i], text:text}]));
  this._draw();
};

export { MiniChart };



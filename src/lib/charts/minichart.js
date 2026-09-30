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
  this._resize();
}

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
  labels.forEach(function(lb,i){
    if(i%step!==0 && i!==n-1) return;
    ctx.fillStyle = tickColor;
    ctx.fillText(String(lb), xAt(i), p.y+p.h+7);
  });

  datasets.forEach(function(ds){
    if(!ds.fill) return;
    var pts = (ds.data||[]).map(function(v,i){ return v==null? null : {x:xAt(i), y:yAt(v)}; });
    var started=false;
    ctx.beginPath();
    pts.forEach(function(pt){ if(!pt) return; if(!started){ ctx.moveTo(pt.x, pt.y); started=true; } else ctx.lineTo(pt.x, pt.y); });
    if(started){
      var filtered = pts.filter(Boolean);
      var lastPt = filtered[filtered.length-1], firstPt = filtered[0];
      ctx.lineTo(lastPt.x, p.y+p.h);
      ctx.lineTo(firstPt.x, p.y+p.h);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(ds.borderColor||'#2a78d6', 0.14);
      ctx.fill();
    }
  });
  datasets.forEach(function(ds){
    var pts = (ds.data||[]).map(function(v,i){ return v==null? null : {x:xAt(i), y:yAt(v)}; });
    ctx.beginPath();
    ctx.strokeStyle = ds.borderColor || '#2a78d6';
    ctx.lineWidth = ds.borderWidth || 2;
    if(ds.borderDash && ds.borderDash.length) ctx.setLineDash(ds.borderDash); else ctx.setLineDash([]);
    var started=false;
    pts.forEach(function(pt){
      if(!pt){ started=false; return; }
      if(!started){ ctx.moveTo(pt.x, pt.y); started=true; } else ctx.lineTo(pt.x, pt.y);
    });
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
  var yAxis = computeYAxis(this._dataMax(datasets), undefined);
  this._barRects = [];
  var self = this;

  if(!horizontal){
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
        ctx.fillStyle = (i===self._hoverIdx) ? shade(ds.backgroundColor,-10) : (ds.backgroundColor||'#2a78d6');
        roundRectTop(ctx, bx, by, barW-2, bh, ds.borderRadius||4);
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
        roundRectRight(ctx, p.x, by, bw, barH, ds.borderRadius||4);
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
  data.forEach(function(v,i){
    var frac = (v||0)/total;
    var end = start + frac*Math.PI*2;
    var hovered = self._hoverArc===i;
    var rr = hovered? r+3 : r;
    ctx.beginPath();
    ctx.moveTo(cx+Math.cos(start)*innerR, cy+Math.sin(start)*innerR);
    ctx.arc(cx,cy,rr,start,end);
    ctx.arc(cx,cy,innerR,end,start,true);
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
  var text = (hit.ds.label? hit.ds.label+': ':'')+hit.v;
  this._showTip(e.clientX, e.clientY, this._tipRowsHTML([{color:hit.ds.backgroundColor,text:text}], String(label)));
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



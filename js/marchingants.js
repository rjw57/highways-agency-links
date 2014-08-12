function MarchingAntsRenderer(trafficData, roadShift, roadWidth) {
  this.trafficData = trafficData;
  this.roadShift = roadShift;
  this.roadWidth = roadWidth;
  return this;
}

MarchingAntsRenderer.prototype.updateCache = function(event) {
  var self = this, trafficData = this.trafficData;
  var vectorContext = event.vectorContext, frameState = event.frameState,
      map = event.target,
      extent = frameState.extent, res = map.getView().getResolution(), tree, graph,
      pixelRatio = frameState.pixelRatio;

  console.log('creating geometry cache at resolution ' + res);

  // The cache covers a slightly larger area then the original extent so
  // that we don't have to do more work than necessary when dragging.
  this.cache = extractVisibleSegments(trafficData,
      [
        extent[0] - 0.25*ol.extent.getWidth(extent),
        extent[1] - 0.25*ol.extent.getHeight(extent),
        extent[2] + 0.25*ol.extent.getWidth(extent),
        extent[3] + 0.25*ol.extent.getHeight(extent),
      ],
      res, this.roadShift);

  this.cachedDraws = [];

  this.cache.links.forEach(function(link) {
    // skip links which are too small
    if(link.length < this.roadWidth*res) { return; }
    if(!link.data.speed || !link.data.flow || !link.data.occupancy) { return; }

    var speed = link.data.speed.value,
        flow = link.data.flow.value,
        occupancy = link.data.occupancy.value;

    var timeOffset = link.geom[0][0] + link.geom[1][0] + link.geom[0][1] + link.geom[1][1];
    var dashSpacing = Math.min(30, 100/occupancy) + 1;
    var lineWidth = Math.max(2, Math.sqrt(flow/speed));

    self.cachedDraws.push({
      strokeStyle: new ol.style.Stroke({
        color: [0, 0, 255, 1],
        width: lineWidth, lineCap: 'butt',
        lineDash: [pixelRatio*lineWidth, pixelRatio*dashSpacing],
      }),
      geom: new ol.geom.LineString(link.geom),
      dashCycle: lineWidth + dashSpacing,
      timeOffset: timeOffset,
      animationSpeed: speed / 25,
    });
  });
};

MarchingAntsRenderer.prototype.handleEvent = function(event) {
  var self = this, trafficData = this.trafficData;

  // Don't do anything if we're animating the map
  if(event.frameState.animate) { return; }

  var vectorContext = event.vectorContext, frameState = event.frameState,
      map = event.target,
      extent = frameState.extent, res = map.getView().getResolution(), tree, graph,
      pixelRatio = frameState.pixelRatio;

  // Do we have this extent cached so we don't need to do a spatial search?
  if(!this.cache || (this.cache.resolution != res) ||
     !this.cache.extent || !ol.extent.containsExtent(this.cache.extent, extent))
  {
    this.updateCache(event);
  }

  for(var idx=0; idx<this.cachedDraws.length; ++idx) {
    var draw = this.cachedDraws[idx];

    // HACK: pokes directly into the "private" field
    var animationTime = 4 * (frameState.time / 1000) + draw.timeOffset;
    var t = animationTime * draw.animationSpeed;

    vectorContext.context_.lineDashOffset = pixelRatio *
      ((draw.dashCycle * Math.ceil(t/draw.dashCycle)) - t);

    vectorContext.setFillStrokeStyle(null, draw.strokeStyle);
    vectorContext.drawLineStringGeometry(draw.geom, null);
  }

  // re-render to draw next frame
  map.render();
};

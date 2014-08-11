// Teach proj4 about the British national grid
proj4.defs("EPSG:27700",
    "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs");

(function() {
'use strict';

// ///// CONSTANTS /////

var WGS84 = 'EPSG:4326',
    MAP_PROJ = 'EPSG:3857';

// scales
var MAX_SPEED=120, MAX_FLOW=5000, MAX_OCCUPANCY=100;

// Amount to shift road segments to "left"
var ROAD_SHIFT = 3; // pixels
var ROAD_WIDTH = 3;

// colour scheme
var LINK_COLOUR = tinycolor({ h: 240, s: 100, v: 75 }).toHexString(),
    SRC_SINK_COLOUR = tinycolor({ h: 0, s: 100, v: 75 }).toHexString();

// Create a promise which gets resolved with an object with the following form:
//  {
//    graph: <DirectedGraph>, // full resolution traffic network
//    simplified: [
//      {
//        minResolution: <Number>?, maxResolution: <Number>?,
//        graph: <DirectedGraph>, tree: <rbush>,
//      },
//    ],
//    data: {
//      speeds: <Object>?,        // map link ids -> speed
//      flows: <Object>?,         // map link ids -> flow
//      occupancies: <Object>?,   // map link ids -> occupancy
//    },
//  }
var fetchData = RealtimeTrafficData.createFetchDataPromise({
  destProjection: MAP_PROJ,
});

fetchData.then(function(v) {
  console.log('fetched data');
  console.log(v);
});

fetchData.catch(function(err) {
  console.log('Error fetching data');
  console.error(err);
});

$(document).ready(function() {
  function stopLoading() { $('body').removeClass('loading'); }
  fetchData.then(stopLoading, stopLoading);

  $('canvas.scale').each(function(idx, canvas) {
    canvas.width = $(canvas).width();
    canvas.height = $(canvas).height();

    var ctx = canvas.getContext('2d'), color, dy=Math.max(1, Math.floor(canvas.height/255));
    for(var y=0; y<canvas.height; y+=dy) {
      color = redGreen(canvas.height-y, canvas.height);
      ctx.fillStyle = tinycolor({r:color[0], g:color[1], b:color[2], a:color[3]}).toHexString();
      ctx.fillRect(0, y, canvas.width, dy);
    }
  });

  // Create the base map
  var map = new ol.Map({
    target: 'map',
    // renderer: ['webgl', 'canvas', 'dom'],
    layers: [
      new ol.layer.Tile({
        source: new ol.source.MapQuest({layer: 'osm'}),
      }),
    ],
    view: new ol.View({
      enableRotation: false,
      maxZoom: 18, minZoom: 0,
      center: ol.proj.transform([-0.09, 51.505], WGS84, MAP_PROJ),
      zoom: 8,
    }),
    controls: ol.control.defaults().extend([
      new ol.control.ScaleLine({ units: 'imperial' }),
    ]),
  });

  // Once we have trafficData, create the map's postcompose event handler
  fetchData.then(function(trafficData) {
    // write some stats
    $('#roadCount').text(trafficData.graph.size);
    $('#pubTime').text(trafficData.timestamps.data.published.toLocaleString());

    // interpolate missing trafficData
    trafficData.data.speeds = interpolateData(trafficData.data.speeds, trafficData.graph);
    trafficData.data.flows = interpolateData(trafficData.data.flows, trafficData.graph);
    trafficData.data.occupancies = interpolateData(trafficData.data.occupancies, trafficData.graph);

    // Calculate entire extent
    var boundingExtent = trafficData.simplified[trafficData.simplified.length-1].tree.data.bbox;
    console.log('bounding extent', boundingExtent);

    // Add control to reset zoom
    map.addControl(new ol.control.ZoomToExtent({
      extent: boundingExtent,
    }));

    // Zoom to extent
    map.getView().fitExtent(boundingExtent, map.getSize());

    // Create an image canvas source layer for the traffic data
    map.addLayer(new ol.layer.Image({
      source: new ol.source.ImageCanvas({
        canvasFunction: createLinksCanvasElementFunction(trafficData),
      }),
    }));

    // Create a post-compose handler for displaying cars
    map.on('postcompose', createPostComposeHandler(trafficData));

    // Re-render the map to kick of a postcompose event.
    map.render();
  });
});

function interpolateData(data, graph) {
  // start with actual data filtered by age
  var outputData = {}, now = Date.now();
  for(var id in data) {
    var datum = data[id];
    // max of 1 hour old
    if(now - datum.when < 1000*60*60*1) {
      outputData[id] = datum;
    }
  }

  function interpolateStep() {
    var newData = {}, nNewData = 0;

    // process each edge
    graph.getEdges().forEach(function(edge) {
      // if already processed, do nothing
      if(outputData[edge.data.id]) { return; }

      // get the source and target nodes
      var srcNode = graph.getNodeById(edge.nodes[0]),
          tgtNode = graph.getNodeById(edge.nodes[1]);

      // get all data for neighbouring edges

      var neighbouringData = [];
      [].concat(
        graph.nodeEdges(srcNode.id),
        graph.nodeEdges(tgtNode.id)
      ).forEach(function(neighbourEdgeId) {
        if(neighbourEdgeId === edge.id) { return; }
        var neighbourEdge = graph.getEdgeById(neighbourEdgeId),
            neighbourEdgeData = outputData[neighbourEdge.data.id];
        if(!neighbourEdgeData) { return; }
        neighbouringData.push(neighbourEdgeData);
      });

      // don't do anything if we've got no neighbouring data
      if(neighbouringData.length === 0) { return; }

      // construct mean of data
      var mean = neighbouringData.reduce(
          function(prev, cur) { return prev + cur.value ;},
          0
      );
      mean /= neighbouringData.length;
      console.assert(!isNaN(mean), mean);

      // construct new data
      newData[edge.data.id] = {
        value: mean,
        interpolated: true,
      };
      nNewData += 1;
    });

    // add new data to output
    outputData = _extend(outputData, newData);

    return nNewData;
  }

  do {
    // ... interpolate ...
  } while(interpolateStep() > 0);

  return outputData;
}

function createLinksCanvasElementFunction(trafficData) {
  return function(extent, resolution, pixelRatio, imageSize, projection) {
    console.log('creating canvas at resolution ' + resolution);

    var visibleSegments = extractVisibleSegments(trafficData, extent, resolution),
        graph = visibleSegments.graph, tree = visibleSegments.tree,
        visibleLinks = visibleSegments.links;

    var canvas = document.createElement('canvas');

    // size canvas appropriately
    canvas.width = imageSize[0]; canvas.height = imageSize[1];

    // get drawing context
    var ctx = canvas.getContext('2d');

    // setup canvas to accept raw projection co-ordinates
    ctx.transform(
        pixelRatio/resolution, 0, 0, -pixelRatio/resolution,
        -pixelRatio*extent[0]/resolution, pixelRatio*extent[3]/resolution
    );

    // Draw each line segment's background
    ctx.lineWidth = (ROAD_WIDTH+2) * resolution;
    ctx.lineCap = 'round';
    ctx.beginPath();
    visibleLinks.forEach(function(segment) {
      ctx.moveTo(segment.geom[0][0], segment.geom[0][1]);
      ctx.lineTo(segment.geom[1][0], segment.geom[1][1]);
    });
    ctx.stroke();

    // Draw each line segment appropriately coloured
    ctx.lineWidth = ROAD_WIDTH * resolution;
    ctx.lineCap = 'round';
    visibleLinks.forEach(function(segment) {
      var isValid, color;

      isValid = (segment.data.speed && !segment.data.speed.interpolated);
      color = isValid ? redGreen(segment.data.speed.value, MAX_SPEED) : [128,128,128,1];
//      isValid = (segment.data.flow && !segment.data.flow.interpolated);
//      color = isValid ? heat(segment.data.flow.value, MAX_FLOW) : [128,128,128,1];

      ctx.strokeStyle = tinycolor(
        {r:color[0], g:color[1], b:color[2], a:color[3]}).toHexString();

      ctx.beginPath();
      ctx.moveTo(segment.geom[0][0], segment.geom[0][1]);
      ctx.lineTo(segment.geom[1][0], segment.geom[1][1]);
      ctx.stroke();
    });

    return canvas;
  };
}

function createPostComposeHandler(trafficData) {
  // A cache of visible links.
  var cache;

  // The car icon image element.
  var imageElement = document.createElement('img');
  imageElement.src = 'img/car-blue.png';

  return function(event) {
    // Don't do anything if we're animating the map
    if(event.frameState.animate) { return; }

    var vectorContext = event.vectorContext, frameState = event.frameState,
        map = event.target,
        extent = frameState.extent, res = map.getView().getResolution(), tree, graph,
        pixelRatio = frameState.pixelRatio;

    // Do we have this extent cached so we don't need to do a spatial search?
    if(!cache || (cache.resolution != res) ||
       !cache.extent || !ol.extent.containsExtent(cache.extent, extent)) {
      console.log('creating geometry cache at resolution ' + res);

      // The cache covers a slightly larger area then the original extent so
      // that we don't have to do more work than necessary when dragging.
      cache = extractVisibleSegments(trafficData,
          [
            extent[0] - 0.25*ol.extent.getWidth(extent),
            extent[1] - 0.25*ol.extent.getHeight(extent),
            extent[2] + 0.25*ol.extent.getWidth(extent),
            extent[3] + 0.25*ol.extent.getHeight(extent),
          ],
          res);
    }


    cache.links.forEach(function(link) {
      // skip links which are too small
      if(link.length < ROAD_WIDTH*res) { return; }

      var timeOffset = link.geom[0][0] + link.geom[1][0] + link.geom[0][1] + link.geom[1][1];
      var animationTime = 4 * (frameState.time / 1000) + timeOffset;
      var dashSpacing = Math.min(30, 100/link.data.occupancy.value);

      // HACK: pokes directly into the "private" field
      var t = animationTime * link.data.speed.value / 120;
      vectorContext.context_.lineDashOffset = t - (dashSpacing * Math.floor(t/dashSpacing));

      vectorContext.setFillStrokeStyle(null, new ol.style.Stroke({
        color: 'blue', width: ROAD_WIDTH, lineDash: [1, dashSpacing-1],
      }));
      vectorContext.drawLineStringGeometry(new ol.geom.LineString(link.geom), null);
    });

    // re-render to draw next frame
    map.render();
  };
}

function extractVisibleSegments(trafficData, extent, resolution) {
  var graphAndTree = graphAndTreeForResolution(trafficData, resolution),
      graph = graphAndTree.graph, tree = graphAndTree.tree,
      visibleLinks = visibleLinksInTree(tree, extent);

  // Create list of line links
  var links = visibleLinks.map(function(link) {
    var edge = graph.getEdgeById(link[4]),
        p1 = graph.getNodeById(edge.nodes[0]).data.pos,
        p2 = graph.getNodeById(edge.nodes[1]).data.pos,
        dx = p2[0]-p1[0], dy = p2[1]-p1[1],
        deltaLen = Math.sqrt(dx*dx + dy*dy),
        unitDelta = [dx/deltaLen, dy/deltaLen],
        lineShift = ROAD_SHIFT * resolution;

    // Extract data for edge
    var edgeData = {
      speed: trafficData.data.speeds[edge.data.id],
      flow: trafficData.data.flows[edge.data.id],
      occupancy: trafficData.data.occupancies[edge.data.id],
    };

    // Each line string is shifted to the "left" in image space
    return {
      data: edgeData,
      geom: [
        [ p1[0] - unitDelta[1]*lineShift, p1[1] + unitDelta[0]*lineShift ],
        [ p2[0] - unitDelta[1]*lineShift, p2[1] + unitDelta[0]*lineShift ],
      ],
      length: deltaLen,
      unitDirection: unitDelta,
    };
  });

  return {
    extent: extent, resolution: resolution,
    links: links, graph: graph, tree: tree,
  };
}

function graphAndTreeForResolution(trafficData, res) {
  var rv = {};
  trafficData.simplified.forEach(function(n) {
    if(n.minResolution && (res < n.minResolution)) { return; }
    if(n.maxResolution && (res > n.maxResolution)) { return; }
    rv.tree = n.tree; rv.graph = n.graph;
  });
  return rv;
}

function visibleLinksInTree(tree, extent) {
  return tree.search(extent);
}

// utility functions

function redGreen(x, maxX, reversed) {
  if(reversed) { x = maxX - x; }
  var lambda = Math.max(0, Math.min(1, x / maxX)),
      r = Math.max(0, Math.min(1, 2-lambda*2)),
      g = Math.max(0, Math.min(1, lambda*2)),
      b = 0;
  return [255*r, 255*g, 255*b, 1];
}

function heat(x, maxX, reversed) {
  if(reversed) { x = maxX - x; }
  var lambda = Math.max(0, Math.min(1, x / maxX)),
      r = Math.min(1, lambda*3),
      g = Math.max(0, Math.min(1, (lambda-0.33)*3)),
      b = Math.max(0, Math.min(1, (lambda-0.66)*3));
  return [255*r, 255*g, 255*b, 1];
}

function _extend(obj, otherObj) {
  if(!obj) { return obj; }
  for(var i in otherObj) { obj[i] = otherObj[i]; }
  return obj;
}

})();

// Teach proj4 about the British national grid
proj4.defs("EPSG:27700",
    "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs");

(function() {
'use strict';

// ///// CONSTANTS /////

var WGS84 = 'EPSG:4326',
    MAP_PROJ = 'EPSG:3857';

// Amount to shift road segments to "left"
var ROAD_SHIFT = 2; // pixels

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

  // Once we have data, create the map's postcompose event handler
  fetchData.then(function(data) {
    // write some stats
    $('#roadCount').text(data.graph.size);
    $('#pubTime').text(data.timestamps.data.published.toLocaleString());

    // Calculate entire extent
    var boundingExtent = data.simplified[data.simplified.length-1].tree.data.bbox;
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
        canvasFunction: createLinksCanvasElementFunction(data),
      }),
    }));

    // Create a post-compose handler for displaying cars
    map.on('postcompose', createPostComposeHandler(data));

    // Re-render the map to kick of a postcompose event.
    map.render();
  });
});

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
    ctx.lineWidth = 5 * resolution;
    ctx.lineCap = 'round';
    ctx.beginPath();
    visibleLinks.forEach(function(segment) {
      ctx.moveTo(segment.geom[0][0], segment.geom[0][1]);
      ctx.lineTo(segment.geom[1][0], segment.geom[1][1]);
    });
    ctx.stroke();

    // Draw each line segment appropriately coloured
    ctx.lineWidth = 2 * resolution;
    ctx.lineCap = 'round';
    visibleLinks.forEach(function(segment) {
      var color = segment.data.speed ? redGreen(segment.data.speed.value, 120) : [128,128,128,1];
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

    var zoomedOut = res > 100,
        carLength = zoomedOut ? 6 : 30,
        spacing;

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

    // Default image style if res is too coarse
    var circImageStyle = new ol.style.Circle({
      fill: new ol.style.Fill({ color: [0,0,255,1] }),
      radius: 3*pixelRatio,
    });

    // amount to scale occupancy by to make perception match reality
    var perceptionFudge = 2;

    cache.links.forEach(function(link) {
      // Reject too small links
      if(link.length < res*carLength) { return; }

      var speed = link.data.speed,
          occupancy = link.data.occupancy,
          flow = link.data.flow;

      // Do we have the information for car icons?
      if(!speed || !occupancy) {
        return;
      }

      var p1 = link.geom[0], p2 = link.geom[1],
          unitDelta = link.unitDirection,
          rotation = Math.atan2(unitDelta[1], unitDelta[0]);

      var timeOffset = p1[0] + p2[0] + p1[1] + p2[1], // animation time offset for link
          animationTime = frameState.time + timeOffset,
          imageStyle = circImageStyle,
          lambda, offset;

      // Do we have the information for car icons?
      spacing = (100/(perceptionFudge * occupancy.value)) * res * carLength;
      offset = res * (speed.value / 10) * animationTime / 1000;
      offset -= spacing * Math.floor(offset/spacing);

      var pointCoords = [];
      for(lambda = offset; lambda < link.length; lambda += spacing) {
        pointCoords.push([ p1[0] + unitDelta[0]*lambda, p1[1] + unitDelta[1]*lambda, ]);
      }

      if(!zoomedOut) {
        imageStyle = new ol.style.Icon({
            anchor: [0.5, 0.5],
            rotation: - rotation + 0.5 * Math.PI,
            rotateWithView: true,
            snapToPixel: false,
            img: imageElement,
            scale: pixelRatio * carLength / 100,
            size: [50,100],
        });
      }

      vectorContext.setImageStyle(imageStyle);
      vectorContext.drawMultiPointGeometry(
          new ol.geom.MultiPoint(pointCoords), null);
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

function redGreen(x, maxX) {
  var lambda = Math.max(0, Math.min(1, x / maxX)),
      s = Math.sin(lambda*0.5*Math.PI);
  return [255*(1-s*s), 255*(s*s), 0, 1];
}

function _extend(obj, otherObj) {
  if(!obj) { return obj; }
  for(var i in otherObj) { obj[i] = otherObj[i]; }
  return obj;
}

})();

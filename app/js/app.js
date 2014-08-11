// Teach proj4 about the British national grid
proj4.defs("EPSG:27700",
    "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs");

(function() {
'use strict';

// ///// CONSTANTS /////

var WGS84 = 'EPSG:4326',
    MAP_PROJ = 'EPSG:3857';

// Amount to shift road segments to "left"
var ROAD_SHIFT = 5; // pixels

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
        //source: new ol.source.BingMaps({
        //  key: 'AvsuiJVtmn-zxz7hjF_DnAI7PGecNnzJFsNi7V69yd0BUdWYNlyetZblBtnRUcEI',
        //  imagerySet: 'Aerial',
        //  //layer: 'osm'
        //}),
      }),
      //new ol.layer.Tile({
      //  source: new ol.source.XYZ({
      //    url: '//1.tile.openweathermap.org/map/rain_cls/{z}/{x}/{y}.png',
      //  }),
      //}),
    ],
    view: new ol.View({
      center: ol.proj.transform([-0.09, 51.505], WGS84, MAP_PROJ),
      zoom: 8,
    }),
  });

  // Once we have data, create the map's postcompose event handler
  fetchData.then(function(data) {
    // Create an image canvas source for the traffic data
    var linksSource = new ol.source.ImageCanvas({
      canvasFunction: createLinksCanvasElementFunction(data),
    });

    map.addLayer(new ol.layer.Image({
      source: linksSource,
    }));

    var cache = {};

    var imageElement = document.createElement('img');
    imageElement.src = 'img/car-blue.png';


    map.on('postcompose', function(event) {
      // Don't do anything if we're animating the map
      if(event.frameState.animate) { return; }

      var vectorContext = event.vectorContext, frameState = event.frameState,
          extent = frameState.extent, res = map.getView().getResolution(), tree, graph,
          zoomedOut = (res > 100),
          carLength = zoomedOut ? 6 : 30, spacing;

      // Do we have this extent cached so we don't need to do a spatial search?
      if(!cache.extent ||
          (extent[0] !== cache.extent[0]) || (extent[1] !== cache.extent[1]) ||
          (extent[2] !== cache.extent[2]) || (extent[3] !== cache.extent[3]))
      {
        console.log('creating geometry cache at resolution ' + res);

        cache.extent = extent;
        cache.tree = null; cache.graph = null;

        data.simplified.forEach(function(n) {
          if(n.minResolution && (res < n.minResolution)) { return; }
          if(n.maxResolution && (res > n.maxResolution)) { return; }
          cache.tree = n.tree; cache.graph = n.graph;
        });

        if(!cache.tree || !cache.graph) { return; }
        cache.visibleLinks = cache.tree.search(frameState.extent);
      }

      // Record point geometries we need to draw.
      var multiPointDraws = [];

      // Default image style if res is too coarse
      var circImageStyle = new ol.style.Circle({
        fill: new ol.style.Fill({ color: [0,0,255,1] }),
        radius: 3,
      });

      cache.visibleLinks.forEach(function(link) {
        var edge = cache.graph.getEdgeById(link[4]),
            speed = data.data.speeds[edge.data.id],
            occupancy = data.data.occupancies[edge.data.id],
            colour,
            p1 = cache.graph.getNodeById(edge.nodes[0]).data.pos,
            p2 = cache.graph.getNodeById(edge.nodes[1]).data.pos,
            timeOffset = p1[0] + p2[0] + p1[1] + p2[1], // animation time offset for link
            animationTime = frameState.time + timeOffset,
            delta = [p2[0]-p1[0], p2[1]-p1[1]],
            deltaLen = Math.sqrt(delta[0]*delta[0] + delta[1]*delta[1]),
            unitDelta = [delta[0]/deltaLen, delta[1]/deltaLen],
            rotation = Math.atan2(unitDelta[1], unitDelta[0]),
            lambda, offset,
            lineShift = [-unitDelta[1]*res*ROAD_SHIFT, unitDelta[0]*res*ROAD_SHIFT],
            imageStyle = circImageStyle;

        var pointCoords = [], lineString = [];

        // Do we have data for this link?
        colour = (speed === undefined) ?
          [128, 128, 128, 1] : redGreen(speed.value, 120);

        // Special case: zero occupancy is green
        if(occupancy && (occupancy.value === 0)) {
          colour = redGreen(1, 1);
        }

        // shift points a little
        p1 = [p1[0] + lineShift[0], p1[1] + lineShift[1]];
        p2 = [p2[0] + lineShift[0], p2[1] + lineShift[1]];

        // Do we have the information for car icons?
        if((deltaLen > 2*carLength*res) && speed && occupancy && (occupancy.value > 0)) {
          spacing = (100/occupancy.value) * res * carLength;
          spacing = Math.min(spacing, deltaLen);
          offset = res * (speed.value / 10) * animationTime / 1000;
          offset -= spacing * Math.floor(offset/spacing);

          pointCoords = [];
          for(lambda = offset; lambda < deltaLen; lambda += spacing) {
            pointCoords.push([ p1[0] + unitDelta[0]*lambda, p1[1] + unitDelta[1]*lambda, ]);
          }

          if(!zoomedOut) {
            imageStyle = new ol.style.Icon({
                anchor: [0.5, 0.5],
                rotation: - rotation + 0.5 * Math.PI,
                rotateWithView: true,
                snapToPixel: false,
                img: imageElement,
                scale: carLength / 100,
                size: [50,100],
            });
          }

          multiPointDraws.push({
            geom: new ol.geom.MultiPoint(pointCoords),
            style: imageStyle,
          });
        }
      });

      // then points
      multiPointDraws.forEach(function(draw) {
        vectorContext.setImageStyle(draw.style);
        vectorContext.drawMultiPointGeometry(draw.geom, null);
      });

      map.render();
    });
    map.render();
  });
});

function createLinksCanvasElementFunction(trafficData) {
  return function(extent, resolution, pixelRatio, imageSize, projection) {
    console.log('creating canvas at resolution ' + resolution);

    var canvas = document.createElement('canvas'),
        graphAndTree = graphAndTreeForResolution(trafficData, resolution),
        graph = graphAndTree.graph, tree = graphAndTree.tree,
        visibleLinks = visibleLinksInTree(tree, extent);

    // size canvas appropriately
    canvas.width = imageSize[0]; canvas.height = imageSize[1];

    // Create list of line segments
    var segments = visibleLinks.map(function(link) {
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
      };
    });

    // get drawing context
    var ctx = canvas.getContext('2d');

    // setup canvas to accept raw projection co-ordinates
    ctx.transform(
        1/resolution, 0, 0, -1/resolution,
        -extent[0]/resolution, extent[3]/resolution
    );

    // Draw each line segment's background
    ctx.lineWidth = 5 * resolution;
    ctx.lineCap = 'round';
    ctx.beginPath();
    segments.forEach(function(segment) {
      ctx.moveTo(segment.geom[0][0], segment.geom[0][1]);
      ctx.lineTo(segment.geom[1][0], segment.geom[1][1]);
    });
    ctx.stroke();

    // Draw each line segment appropriately coloured
    ctx.lineWidth = 2 * resolution;
    ctx.lineCap = 'round';
    segments.forEach(function(segment) {
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

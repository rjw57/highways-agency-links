var newTrafficDataLayer = (function() {
  function newTrafficDataLayer(options) {
    options = extend({
    }, options || {});

    return new ol.layer.Image({
      source: new ol.source.ImageCanvas({
        canvasFunction: createLinksCanvasElementFunction(options.data, options),
      }),
    });
  }

  function createLinksCanvasElementFunction(trafficData, options) {
    options = extend({
    }, options || {});

    return function(extent, resolution, pixelRatio, imageSize, projection) {
      console.log('creating canvas at resolution ' + resolution);

      var visibleSegments =
            extractVisibleSegments(trafficData, extent, resolution, options.roadShift),
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
      ctx.lineWidth = (options.roadWidth+4) * resolution;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#eee';
      ctx.beginPath();
      visibleLinks.forEach(function(segment) {
        ctx.moveTo(segment.geom[0][0], segment.geom[0][1]);
        ctx.lineTo(segment.geom[1][0], segment.geom[1][1]);
      });
      ctx.stroke();

      // Draw each line segment appropriately coloured
      ctx.lineWidth = options.roadWidth * resolution;
      ctx.lineCap = 'round';
      visibleLinks.forEach(function(segment) {
        var datum = segment.data[options.type], isValid, color, normDatum;

        isValid = (datum && !datum.interpolated);

        if(isValid) {
          normDatum = (datum.value - options.scale.min) / (options.scale.max - options.scale.min);
          color = options.scale.map(normDatum, 1);
        } else {
          color = [128,128,128,1];
        }

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

  return newTrafficDataLayer;
})();


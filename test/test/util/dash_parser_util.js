/**
 * @license
 * Copyright 2016 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

goog.provide('shaka.test.Dash');


/**
 * Constructs and configures a very simple DASH parser.
 * @return {!shaka.dash.DashParser}
 */
shaka.test.Dash.makeDashParser = function() {
  var retry = shaka.net.NetworkingEngine.defaultRetryParameters();
  var parser = new shaka.dash.DashParser();
  parser.configure({
    retryParameters: retry,
    dash: {
      customScheme: function(node) { return null; },
      clockSyncUri: '',
      ignoreDrmInfo: false,
      xlinkFailGracefully: false
    },
    hls: { defaultTimeOffset: 0 }
  });
  return parser;
};


/**
 * Tests the segment index produced by the DASH manifest parser.
 *
 * @param {function()} done
 * @param {string} manifestText
 * @param {!Array.<shaka.media.SegmentReference>} references
 */
shaka.test.Dash.testSegmentIndex = function(done, manifestText, references) {
  var buffer = shaka.util.StringUtils.toUTF8(manifestText);
  var dashParser = shaka.test.Dash.makeDashParser();
  var playerInterface = {
    networkingEngine:
        new shaka.test.FakeNetworkingEngine({'dummy://foo': buffer}),
    filterNewPeriod: function() {},
    filterAllPeriods: function() {},
    onTimelineRegionAdded: fail,  // Should not have any EventStream elements.
    onEvent: fail,
    onError: fail
  };
  dashParser.start('dummy://foo', playerInterface)
      .then(function(manifest) {
        var stream = manifest.periods[0].variants[0].video;
        shaka.test.ManifestParser.verifySegmentIndex(stream, references);
      })
      .catch(fail)
      .then(done);
};


/**
 * Tests that the DASH manifest parser fails to parse the given manifest.
 *
 * @param {function()} done
 * @param {string} manifestText
 * @param {!shaka.util.Error} expectedError
 */
shaka.test.Dash.testFails = function(done, manifestText, expectedError) {
  var manifestData = shaka.util.StringUtils.toUTF8(manifestText);
  var dashParser = shaka.test.Dash.makeDashParser();
  var playerInterface = {
    networkingEngine:
        new shaka.test.FakeNetworkingEngine({'dummy://foo': manifestData}),
    filterNewPeriod: function() {},
    filterAllPeriods: function() {},
    onTimelineRegionAdded: fail,  // Should not have any EventStream elements.
    onEvent: fail,
    onError: fail
  };
  dashParser.start('dummy://foo', playerInterface)
      .then(fail)
      .catch(function(error) {
        shaka.test.Util.expectToEqualError(error, expectedError);
      })
      .then(done);
};


/**
 * Makes a simple manifest with the given representation contents.
 *
 * @param {!Array.<string>} lines
 * @param {number=} opt_duration
 * @param {number=} opt_start
 * @return {string}
 */
shaka.test.Dash.makeSimpleManifestText =
    function(lines, opt_duration, opt_start) {
  var periodAttr = '';
  var mpdAttr = 'type="dynamic" availabilityStartTime="1970-01-01T00:00:00Z"';
  if (opt_duration) {
    periodAttr = 'duration="PT' + opt_duration + 'S"';
    mpdAttr = 'type="static"';
  }
  if (opt_start)
    periodAttr += ' start="PT' + opt_start + 'S"';

  var start = [
    '<MPD ' + mpdAttr + '>',
    '  <Period ' + periodAttr + '>',
    '    <AdaptationSet mimeType="video/mp4">',
    '      <Representation bandwidth="500">',
    '        <BaseURL>http://example.com</BaseURL>'
  ];
  var end = [
    '      </Representation>',
    '    </AdaptationSet>',
    '  </Period>',
    '</MPD>'
  ];
  return start.concat(lines, end).join('\n');
};


/**
 * Makes a simple manifest object for jasmine.toEqual; this does not do any
 * checking.  This only constructs one period with the given stream sets.
 *
 * @param {!Array.<shakaExtern.Variant>} variants
 * @return {shakaExtern.Manifest}
 */
shaka.test.Dash.makeManifestFromVariants = function(variants) {
  return /** @type {shakaExtern.Manifest} */ (jasmine.objectContaining({
    periods: [
      jasmine.objectContaining({
        variants: variants
      })
    ]
  }));
};


/**
 * Makes a simple manifest object for jasmine.toEqual; this does not do any
 * checking.  This only constructs one period with one stream with the given
 * initialization segment data.
 *
 * @param {string} uri The URI of the initialization segment.
 * @param {number} startByte
 * @param {?number} endByte
 * @param {number=} opt_pto The presentationTimeOffset of the stream.
 * @return {shakaExtern.Manifest}
 */
shaka.test.Dash.makeManifestFromInit = function(
    uri, startByte, endByte, opt_pto) {
  return shaka.test.Dash.makeManifestFromVariants([jasmine.objectContaining({
    video: jasmine.objectContaining({
      presentationTimeOffset: (opt_pto || 0),
      createSegmentIndex: jasmine.any(Function),
      findSegmentPosition: jasmine.any(Function),
      initSegmentReference: new shaka.media.InitSegmentReference(
          function() { return ['http://example.com/' + uri]; },
          startByte, endByte)
    })
  })]);
};


/**
 * Calls the createSegmentIndex function of the manifest.  Because we are
 * returning fake data, the parser will fail to parse the segment index; we
 * swallow the error and return a promise that will resolve.
 *
 * @param {shakaExtern.Manifest} manifest
 * @return {!Promise}
 */
shaka.test.Dash.callCreateSegmentIndex = function(manifest) {
  var stream = manifest.periods[0].variants[0].video;
  return stream.createSegmentIndex().then(fail).catch(function() {});
};


/**
 * Makes a set of tests for SegmentTimeline.  This is used to test
 * SegmentTimeline within both SegmentList and SegmentTemplate.
 *
 * @param {string} type The type of manifest being tested; either
 *   'SegmentTemplate' or 'SegmentList'.
 * @param {string} extraAttrs
 * @param {!Array.<string>} extraChildren
 */
shaka.test.Dash.makeTimelineTests = function(type, extraAttrs, extraChildren) {
  describe('SegmentTimeline', function() {
    var Dash = shaka.test.Dash;
    var ManifestParser = shaka.test.ManifestParser;
    var baseUri = 'http://example.com/';

    /**
     * @param {!Array.<string>} timeline
     * @param {string} testAttrs
     * @param {number=} opt_dur
     * @param {number=} opt_start
     * @return {string}
     */
    function makeManifestText(timeline, testAttrs, opt_dur, opt_start) {
      var start = '<' + type + ' ' + extraAttrs + ' ' + testAttrs + '>';
      var end = '</' + type + '>';
      var lines = [].concat(start, extraChildren, timeline, end);
      return Dash.makeSimpleManifestText(lines, opt_dur, opt_start);
    }

    // All tests should have 5 segments and have the relative URIs:
    // s1.mp4  s2.mp4  s3.mp4  s4.mp4  s5.mp4
    it('basic support', function(done) {
      var timeline = [
        '<SegmentTimeline>',
        '  <S d="12" t="34" />',
        '  <S d="21" />',
        '  <S d="44" />',
        '  <S d="10" />',
        '  <S d="10" />',
        '</SegmentTimeline>'
      ];
      var source = makeManifestText(timeline, '');
      var references = [
        ManifestParser.makeReference('s1.mp4', 1, 34, 46, baseUri),
        ManifestParser.makeReference('s2.mp4', 2, 46, 67, baseUri),
        ManifestParser.makeReference('s3.mp4', 3, 67, 111, baseUri),
        ManifestParser.makeReference('s4.mp4', 4, 111, 121, baseUri),
        ManifestParser.makeReference('s5.mp4', 5, 121, 131, baseUri)
      ];
      Dash.testSegmentIndex(done, source, references);
    });

    it('supports repetitions', function(done) {
      var timeline = [
        '<SegmentTimeline>',
        '  <S d="12" t="34" />',
        '  <S d="10" r="2" />',
        '  <S d="44" />',
        '</SegmentTimeline>'
      ];
      var source = makeManifestText(timeline, '');
      var references = [
        ManifestParser.makeReference('s1.mp4', 1, 34, 46, baseUri),
        ManifestParser.makeReference('s2.mp4', 2, 46, 56, baseUri),
        ManifestParser.makeReference('s3.mp4', 3, 56, 66, baseUri),
        ManifestParser.makeReference('s4.mp4', 4, 66, 76, baseUri),
        ManifestParser.makeReference('s5.mp4', 5, 76, 120, baseUri)
      ];
      Dash.testSegmentIndex(done, source, references);
    });

    it('supports negative repetitions', function(done) {
      var timeline = [
        '<SegmentTimeline>',
        '  <S d="8" t="22" />',
        '  <S d="10" r="-1" />',
        '  <S d="12" t="50" />',
        '  <S d="10" />',
        '</SegmentTimeline>'
      ];
      var source = makeManifestText(timeline, '');
      var references = [
        ManifestParser.makeReference('s1.mp4', 1, 22, 30, baseUri),
        ManifestParser.makeReference('s2.mp4', 2, 30, 40, baseUri),
        ManifestParser.makeReference('s3.mp4', 3, 40, 50, baseUri),
        ManifestParser.makeReference('s4.mp4', 4, 50, 62, baseUri),
        ManifestParser.makeReference('s5.mp4', 5, 62, 72, baseUri)
      ];
      Dash.testSegmentIndex(done, source, references);
    });

    it('supports negative repetitions at end', function(done) {
      var timeline = [
        '<SegmentTimeline>',
        '  <S d="5" t="5" />',
        '  <S d="10" r="-1" />',
        '</SegmentTimeline>'
      ];
      var source = makeManifestText(timeline, '', 50 /* duration */);
      var references = [
        ManifestParser.makeReference('s1.mp4', 1, 5, 10, baseUri),
        ManifestParser.makeReference('s2.mp4', 2, 10, 20, baseUri),
        ManifestParser.makeReference('s3.mp4', 3, 20, 30, baseUri),
        ManifestParser.makeReference('s4.mp4', 4, 30, 40, baseUri),
        ManifestParser.makeReference('s5.mp4', 5, 40, 50, baseUri)
      ];
      Dash.testSegmentIndex(done, source, references);
    });

    it('gives times relative to period', function(done) {
      var timeline = [
        '<SegmentTimeline>',
        '  <S t="0" d="10" r="-1" />',
        '</SegmentTimeline>'
      ];
      var source =
          makeManifestText(timeline, '', 50 /* duration */, 30 /* start */);
      var references = [
        ManifestParser.makeReference('s1.mp4', 1, 0, 10, baseUri),
        ManifestParser.makeReference('s2.mp4', 2, 10, 20, baseUri),
        ManifestParser.makeReference('s3.mp4', 3, 20, 30, baseUri),
        ManifestParser.makeReference('s4.mp4', 4, 30, 40, baseUri),
        ManifestParser.makeReference('s5.mp4', 5, 40, 50, baseUri)
      ];
      Dash.testSegmentIndex(done, source, references);
    });

    it('supports @timescale', function(done) {
      var timeline = [
        '<SegmentTimeline>',
        '  <S d="4500" t="18000" />',
        '  <S d="9000" />',
        '  <S d="31500" />',
        '  <S d="9000" />',
        '  <S d="9000" />',
        '</SegmentTimeline>'
      ];
      var source = makeManifestText(timeline, 'timescale="9000"');
      var references = [
        ManifestParser.makeReference('s1.mp4', 1, 2, 2.5, baseUri),
        ManifestParser.makeReference('s2.mp4', 2, 2.5, 3.5, baseUri),
        ManifestParser.makeReference('s3.mp4', 3, 3.5, 7, baseUri),
        ManifestParser.makeReference('s4.mp4', 4, 7, 8, baseUri),
        ManifestParser.makeReference('s5.mp4', 5, 8, 9, baseUri)
      ];
      Dash.testSegmentIndex(done, source, references);
    });
  });
};

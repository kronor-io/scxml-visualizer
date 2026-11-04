/* Example documents shown in the "Example" dropdown. */
(function (global) {
  'use strict';

  var samples = [
    {
      name: 'Traffic light',
      source: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="green">',
        '  <state id="green">',
        '    <transition event="timer" target="yellow"/>',
        '  </state>',
        '  <state id="yellow">',
        '    <transition event="timer" target="red"/>',
        '  </state>',
        '  <state id="red">',
        '    <transition event="timer" target="green"/>',
        '    <transition event="power.off" target="off"/>',
        '  </state>',
        '  <final id="off"/>',
        '</scxml>'
      ].join('\n')
    },
    {
      name: 'Checkout (nested states)',
      source: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="cart">',
        '  <state id="cart">',
        '    <onentry><log expr="\'cart opened\'"/></onentry>',
        '    <transition event="checkout" cond="items &gt; 0" target="checkout"/>',
        '  </state>',
        '',
        '  <state id="checkout" initial="address">',
        '    <state id="address">',
        '      <transition event="next" target="shipping"/>',
        '    </state>',
        '    <state id="shipping">',
        '      <transition event="next" target="payment"/>',
        '      <transition event="back" target="address"/>',
        '    </state>',
        '    <state id="payment">',
        '      <onentry><send event="payment.start"/></onentry>',
        '      <transition event="payment.ok" target="confirmed"/>',
        '      <transition event="payment.failed" target="payment"/>',
        '      <transition event="back" target="shipping"/>',
        '    </state>',
        '    <transition event="cancel" target="cart"/>',
        '  </state>',
        '',
        '  <state id="confirmed">',
        '    <transition event="done" target="end"/>',
        '  </state>',
        '  <final id="end"/>',
        '</scxml>'
      ].join('\n')
    },
    {
      name: 'Media player (parallel + history)',
      source: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="idle">',
        '  <state id="idle">',
        '    <transition event="load" target="player"/>',
        '  </state>',
        '',
        '  <state id="player">',
        '    <history id="player.hist" type="deep">',
        '      <transition target="active"/>',
        '    </history>',
        '    <parallel id="active">',
        '      <state id="playback" initial="paused">',
        '        <state id="paused">',
        '          <transition event="play" target="playing"/>',
        '        </state>',
        '        <state id="playing">',
        '          <onentry><send event="tick" delay="1s"/></onentry>',
        '          <transition event="pause" target="paused"/>',
        '          <transition event="tick" type="internal"/>',
        '        </state>',
        '      </state>',
        '      <state id="audio" initial="unmuted">',
        '        <state id="unmuted">',
        '          <transition event="mute" target="muted"/>',
        '        </state>',
        '        <state id="muted">',
        '          <transition event="unmute" target="unmuted"/>',
        '        </state>',
        '      </state>',
        '      <state id="display" initial="windowed">',
        '        <state id="windowed">',
        '          <transition event="fullscreen" target="fullscreen"/>',
        '        </state>',
        '        <state id="fullscreen">',
        '          <transition event="escape" target="windowed"/>',
        '        </state>',
        '      </state>',
        '    </parallel>',
        '    <transition event="settings" target="settings"/>',
        '    <transition event="eject" target="idle"/>',
        '  </state>',
        '',
        '  <state id="settings">',
        '    <transition event="close" target="player.hist"/>',
        '  </state>',
        '</scxml>'
      ].join('\n')
    }
  ];

  global.ScxmlSamples = samples;
})(window);

(function (window) {
  "use strict";

  var wc = window.wc || {};
  var wp = window.wp || {};
  var registry = wc.wcBlocksRegistry;
  var settings = wc.wcSettings;
  var element = wp.element;
  var name = window.twoincBlocksName;

  if (!registry || !settings || !element || !name) {
    return;
  }

  var data = settings.getSetting(name + "_data", null);
  if (!data) {
    return;
  }

  var decode =
    (wp.htmlEntities && wp.htmlEntities.decodeEntities) ||
    function (value) {
      return value;
    };
  var title = decode(data.title || "");

  function html(markup, className) {
    if (!markup) {
      return null;
    }
    return element.createElement("span", {
      className: className,
      dangerouslySetInnerHTML: { __html: markup }
    });
  }

  function Label() {
    return element.createElement(
      "span",
      { className: "twoinc-blocks-label" },
      data.iconUrl
        ? element.createElement("img", {
            src: data.iconUrl,
            alt: title,
            className: "twoinc-blocks-icon"
          })
        : null,
      element.createElement("span", null, title),
      html(data.about, "twoinc-blocks-about")
    );
  }

  function Content() {
    return html(data.subtitle, "twoinc-blocks-subtitle");
  }

  registry.registerPaymentMethod({
    name: name,
    label: element.createElement(Label, null),
    content: element.createElement(Content, null),
    edit: element.createElement(Content, null),
    ariaLabel: title,
    canMakePayment: function () {
      return true;
    },
    supports: {
      features: data.supports || ["products"]
    }
  });
})(window);

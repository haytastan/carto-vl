precision highp float;

varying highp vec2 featureIDVar;
varying highp vec4 color;
varying highp vec2 pointCoord;

$label_preface
$propertyPreface

void main(void) {
    vec2 featureID = abs(featureIDVar);
    vec2 canvasUV = pointCoord*0.5+vec2(0.5);
    vec4 labelColor = $label_inline;
    vec4 noOverrideColor = vec4(0.);

    vec4 c;
    if (color != noOverrideColor){
        c = color * vec4(vec3(1), labelColor.a);
    }else{
        c = labelColor;
    }
    if (canvasUV!=clamp(canvasUV, 0.,1.)){
        c.a = 0.;
    }

    gl_FragColor = vec4(c.rgb*c.a, c.a);
}
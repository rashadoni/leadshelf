#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) {
      fprintf(stderr, "usage: apple-vision-ocr <image>\n");
      return 2;
    }

    NSString *path = [NSString stringWithUTF8String:argv[1]];
    NSImage *image = [[NSImage alloc] initWithContentsOfFile:path];
    CGImageRef cgImage = [image CGImageForProposedRect:NULL context:nil hints:nil];
    if (cgImage == NULL) {
      fprintf(stderr, "image_load_failed\n");
      return 1;
    }

    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = NO;
    request.recognitionLanguages = @[@"en-US", @"tr-TR"];

    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cgImage options:@{}];
    NSError *error = nil;
    if (![handler performRequests:@[request] error:&error]) {
      fprintf(
        stderr,
        "vision_error domain=%s code=%ld description=%s\n",
        error.domain.UTF8String ?: "null",
        (long)error.code,
        error.localizedDescription.UTF8String ?: "null"
      );
      return 1;
    }

    NSMutableArray *rows = [NSMutableArray array];
    for (VNRecognizedTextObservation *observation in request.results) {
      VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
      if (candidate == nil) continue;
      CGRect box = observation.boundingBox;
      [rows addObject:@{
        @"text": candidate.string,
        @"confidence": @(candidate.confidence),
        @"x": @(box.origin.x),
        @"y": @(box.origin.y),
        @"width": @(box.size.width),
        @"height": @(box.size.height),
      }];
    }

    NSData *json = [NSJSONSerialization dataWithJSONObject:rows options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:&error];
    if (json == nil) {
      fprintf(stderr, "%s\n", error.localizedDescription.UTF8String);
      return 1;
    }
    [json writeToFile:@"/dev/stdout" atomically:NO];
    fwrite("\n", 1, 1, stdout);
  }
  return 0;
}

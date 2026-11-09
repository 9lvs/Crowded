import SwiftUI

@main
struct CrowdedApp: App {
    @State private var model: AppModel = AppModel.makeDefault()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(model.theme.colorScheme)
                .tint(Colors.text)
        }
    }
}
